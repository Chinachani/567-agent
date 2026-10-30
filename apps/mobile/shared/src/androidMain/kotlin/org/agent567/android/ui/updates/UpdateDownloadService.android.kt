package org.agent567.android.ui.updates

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.io.File
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.ensureActive
import org.agent567.android.ui.i18n.Str
import org.json.JSONObject
import org.agent567.android.AppVersion
import org.agent567.android.core.updates.ApkUpdateIdentity
import org.agent567.android.core.updates.validateApkUpdate

internal object AndroidUpdateDownloadStore {
    private val mutable = MutableStateFlow(UpdateDownloadState())
    val state = mutable.asStateFlow()
    private var initialized = false
    var spec: ApkDownloadSpec? = null
        private set

    @Synchronized fun initialize(context: Context) {
        if (initialized) return
        initialized = true
        val saved = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString("spec", null) ?: return
        val restored = runCatching {
            val json = JSONObject(saved)
            ApkDownloadSpec(json.getString("url"), json.getString("version"), json.getString("name"), json.getLong("size"), json.getString("sha256"))
        }.getOrNull() ?: return
        if (restored.version.removePrefix("v") == AppVersion.NAME) {
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().remove("spec").apply()
            return
        }
        spec = restored
        // A process restart never starts a transfer or installs a package by itself.
        mutable.value = UpdateDownloadState(UpdateDownloadPhase.Paused, restored.version, totalBytes = restored.expectedBytes)
    }

    @Synchronized fun save(context: Context, value: ApkDownloadSpec) {
        val json = JSONObject().put("url", value.url).put("version", value.version).put("name", value.fileName)
            .put("size", value.expectedBytes).put("sha256", value.sha256)
        if (!context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString("spec", json.toString()).commit()) {
            error("Unable to save the update download")
        }
        spec = value
    }

    fun update(value: UpdateDownloadState) { mutable.value = value }
    fun fail(message: String) { mutable.value = mutable.value.copy(phase = UpdateDownloadPhase.Error, error = message) }
    fun directory(context: Context) = File(context.filesDir, "updates")
    private const val PREFERENCES = "agent567-update-download"
}

/** Owns the transfer independently of the About screen and keeps it visible while backgrounded. */
class UpdateDownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var job: Job? = null
    private lateinit var downloader: ResumableApkDownloader
    private var lastNotificationAt = 0L

    override fun onCreate() {
        super.onCreate()
        AndroidUpdateDownloadStore.initialize(this)
        downloader = ResumableApkDownloader(AndroidUpdateDownloadStore.directory(this))
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, Str.updateDownloadChannel, NotificationManager.IMPORTANCE_LOW),
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_PAUSE) {
            if (job != null) pause() else stopSelf(startId)
            return START_NOT_STICKY
        }
        if (job?.isActive == true) return START_NOT_STICKY
        if (job != null) {
            // Cancellation may still be flushing a piece; never start a second writer meanwhile.
            AndroidUpdateDownloadStore.update(AndroidUpdateDownloadStore.state.value.copy(phase = UpdateDownloadPhase.Paused))
            stopSelf(startId)
            return START_NOT_STICKY
        }
        val spec = AndroidUpdateDownloadStore.spec
        if (spec == null) { stopSelf(); return START_NOT_STICKY }
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(),
                if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0)
        } catch (_: Exception) {
            AndroidUpdateDownloadStore.fail(Str.updateDownloadStartFailed)
            stopSelf()
            return START_NOT_STICKY
        }
        AndroidUpdateDownloadStore.update(UpdateDownloadState(UpdateDownloadPhase.Downloading, spec.version, totalBytes = spec.expectedBytes))
        job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                val startedAt = android.os.SystemClock.elapsedRealtime()
                var initialBytes: Long? = null
                val file = downloader.download(spec) { progress ->
                    if (AndroidUpdateDownloadStore.state.value.phase == UpdateDownloadPhase.Pausing) return@download
                    val baseline = initialBytes?.coerceAtMost(progress.downloadedBytes) ?: progress.downloadedBytes
                    initialBytes = baseline
                    val speed = ((progress.downloadedBytes - baseline) * 1000 / (android.os.SystemClock.elapsedRealtime() - startedAt).coerceAtLeast(1))
                    AndroidUpdateDownloadStore.update(UpdateDownloadState(UpdateDownloadPhase.Downloading, spec.version, progress.downloadedBytes, progress.totalBytes, bytesPerSecond = speed))
                    notifyProgress()
                }
                coroutineContext.ensureActive()
                AndroidUpdateDownloadStore.update(AndroidUpdateDownloadStore.state.value.copy(phase = UpdateDownloadPhase.Verifying))
                notifyProgress(force = true)
                withContext(Dispatchers.IO) { verifyApkIdentity(this@UpdateDownloadService, file) }
                coroutineContext.ensureActive()
                AndroidUpdateDownloadStore.update(AndroidUpdateDownloadStore.state.value.copy(phase = UpdateDownloadPhase.Ready, error = null))
            } catch (error: CancellationException) {
                if (AndroidUpdateDownloadStore.state.value.phase != UpdateDownloadPhase.Paused) {
                    AndroidUpdateDownloadStore.update(AndroidUpdateDownloadStore.state.value.copy(phase = UpdateDownloadPhase.Paused))
                }
                throw error
            } catch (_: Exception) {
                AndroidUpdateDownloadStore.fail(Str.updateDownloadFailed)
            } finally {
                job = null
                stopForeground(STOP_FOREGROUND_DETACH)
                notifyProgress(force = true)
                stopSelf(startId)
            }
        }
        job?.start()
        return START_NOT_STICKY
    }

    private fun pause() {
        AndroidUpdateDownloadStore.update(AndroidUpdateDownloadStore.state.value.copy(phase = UpdateDownloadPhase.Pausing))
        downloader.cancel()
        job?.cancel()
        if (job == null) { stopForeground(STOP_FOREGROUND_DETACH); notifyProgress(force = true); stopSelf() }
    }

    override fun onTimeout(startId: Int, fgsType: Int) { pause(); stopSelf(startId) }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onDestroy() { downloader.cancel(); scope.cancel(); super.onDestroy() }

    private fun notifyProgress(force: Boolean = false) {
        val now = android.os.SystemClock.elapsedRealtime()
        if (!force && now - lastNotificationAt < 500) return
        lastNotificationAt = now
        runCatching { getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification()) }
    }

    private fun notification(): Notification {
        val state = AndroidUpdateDownloadStore.state.value
        val running = state.phase in setOf(UpdateDownloadPhase.Downloading, UpdateDownloadPhase.Pausing, UpdateDownloadPhase.Verifying)
        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        val builder = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(Str.appName + " · " + Str.updateDownloadChannel)
            .setContentText(when (state.phase) {
                UpdateDownloadPhase.Ready -> Str.updateDownloadReady
                UpdateDownloadPhase.Paused -> Str.updateDownloadPaused
                UpdateDownloadPhase.Pausing -> Str.updateDownloadPausing
                UpdateDownloadPhase.Error -> state.error ?: Str.updateDownloadFailed
                UpdateDownloadPhase.Verifying -> Str.updateDownloadVerifying
                else -> Str.updateDownloadProgress(state.downloadedBytes, state.totalBytes)
            })
            .setOnlyAlertOnce(true)
            .setOngoing(running)
        if (launch != null) builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        if (state.phase == UpdateDownloadPhase.Downloading) {
            val percent = if (state.totalBytes > 0) (state.downloadedBytes * 100 / state.totalBytes).toInt().coerceIn(0, 100) else 0
            builder.setProgress(100, percent, state.totalBytes <= 0)
            val pause = Intent(this, UpdateDownloadService::class.java).setAction(ACTION_PAUSE)
            builder.addAction(0, Str.updateDownloadPause, PendingIntent.getService(this, 1, pause, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
        return builder.build()
    }

    companion object {
        const val ACTION_PAUSE = "org.agent567.UPDATE_DOWNLOAD_PAUSE"
        private const val CHANNEL = "agent567-update-download"
        private const val NOTIFICATION_ID = 56701
    }
}

/** Check the same application and current signing identity before handing a file to Android. */
@Suppress("DEPRECATION")
internal fun verifyApkIdentity(context: Context, apk: File) {
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val archive = context.packageManager.getPackageArchiveInfo(apk.absolutePath, flags) ?: error("Invalid APK archive")
    val installed = context.packageManager.getPackageInfo(context.packageName, flags)
    val incomingCode = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
    val installedCode = if (Build.VERSION.SDK_INT >= 28) installed.longVersionCode else installed.versionCode.toLong()
    val incoming = if (Build.VERSION.SDK_INT >= 28) archive.signingInfo?.apkContentsSigners else archive.signatures
    val current = if (Build.VERSION.SDK_INT >= 28) installed.signingInfo?.apkContentsSigners else installed.signatures
    fun signers(signatures: Array<android.content.pm.Signature>?): Set<String> = signatures.orEmpty().map {
        MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).joinToString("") { byte -> "%02x".format(byte) }
    }.toSet()
    validateApkUpdate(
        ApkUpdateIdentity(context.packageName, installedCode, signers(current)),
        ApkUpdateIdentity(archive.packageName, incomingCode, signers(incoming)),
    )
}
