package org.agent567.android.ui.updates

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.Manifest
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.agent567.android.core.api.AppUpdateCheckResult
import org.agent567.android.ui.i18n.Str

@Composable
actual fun rememberUpdateDownloadActions(): UpdateDownloadActions {
    val context = LocalContext.current.applicationContext
    val actions = remember(context) { AndroidUpdateDownloadActions(context) }
    // A denied notification permission does not prohibit a user-started foreground download.
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    return remember(actions, notificationPermission) { object : UpdateDownloadActions by actions {
        override fun start(update: AppUpdateCheckResult) {
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
            actions.start(update)
        }
    } }
}

internal class AndroidUpdateDownloadActions(private val context: Context) : UpdateDownloadActions {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    override val state = AndroidUpdateDownloadStore.state
    private var starting = false
    private var pauseRequested = false
    private var installing = false
    init { AndroidUpdateDownloadStore.initialize(context) }

    override fun start(update: AppUpdateCheckResult) {
        if (starting || state.value.phase in setOf(UpdateDownloadPhase.Downloading, UpdateDownloadPhase.Pausing, UpdateDownloadPhase.Verifying)) return
        if (context.packageName != "com.api567.agent") {
            AndroidUpdateDownloadStore.fail(Str.updateDownloadWrongPackage)
            return
        }
        val spec = runCatching {
            val digest = requireNotNull(update.apkSha256)
            val name = requireNotNull(update.apkName)
            val size = requireNotNull(update.apkSize)
            val url = requireNotNull(update.apkUrl)
            require(digest.matches(Regex("[0-9a-fA-F]{64}")) && size in 1..MAX_PACKAGE_BYTES)
            require(name.matches(Regex("[A-Za-z0-9._-]{1,120}\\.apk", RegexOption.IGNORE_CASE)))
            ApkDownloadSpec(url, update.latestVersion, name, size, digest)
        }.getOrNull()
        if (spec == null) {
            AndroidUpdateDownloadStore.fail(Str.updateDownloadMetadataMissing)
            return
        }
        starting = true
        pauseRequested = false
        AndroidUpdateDownloadStore.update(UpdateDownloadState(UpdateDownloadPhase.Downloading, spec.version, totalBytes = spec.expectedBytes))
        scope.launch {
            try {
                withContext(Dispatchers.IO) { AndroidUpdateDownloadStore.save(context, spec) }
                if (pauseRequested) AndroidUpdateDownloadStore.update(state.value.copy(phase = UpdateDownloadPhase.Paused))
                else startService()
            } catch (_: Exception) {
                AndroidUpdateDownloadStore.fail(Str.updateDownloadStartFailed)
            } finally { starting = false }
        }
    }

    override fun pause() {
        if (state.value.phase != UpdateDownloadPhase.Downloading) return
        if (starting) {
            pauseRequested = true
            AndroidUpdateDownloadStore.update(state.value.copy(phase = UpdateDownloadPhase.Pausing))
            return
        }
        AndroidUpdateDownloadStore.update(state.value.copy(phase = UpdateDownloadPhase.Pausing))
        runCatching { context.startService(Intent(context, UpdateDownloadService::class.java).setAction(UpdateDownloadService.ACTION_PAUSE)) }
            .onFailure { AndroidUpdateDownloadStore.fail(Str.updateDownloadStartFailed) }
    }

    override fun resume() {
        if (starting || state.value.phase in setOf(UpdateDownloadPhase.Downloading, UpdateDownloadPhase.Pausing, UpdateDownloadPhase.Verifying)) return
        if (AndroidUpdateDownloadStore.spec == null) return
        startService()
    }

    private fun startService() {
        try {
            AndroidUpdateDownloadStore.update(state.value.copy(phase = UpdateDownloadPhase.Downloading, error = null))
            ContextCompat.startForegroundService(context, Intent(context, UpdateDownloadService::class.java))
        } catch (_: Exception) { AndroidUpdateDownloadStore.fail(Str.updateDownloadStartFailed) }
    }

    override fun install() {
        if (installing || state.value.phase != UpdateDownloadPhase.Ready) return
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            runCatching {
                context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }.onFailure { AndroidUpdateDownloadStore.fail(Str.updateDownloadInstallFailed) }
            return
        }
        val spec = AndroidUpdateDownloadStore.spec ?: return
        installing = true
        scope.launch {
            try {
                val file = File(AndroidUpdateDownloadStore.directory(context), spec.fileName)
                withContext(Dispatchers.IO) {
                    ResumableApkDownloader(AndroidUpdateDownloadStore.directory(context)).verifyFile(spec, file)
                    verifyApkIdentity(context, file)
                }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
                context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
            } catch (_: Exception) { AndroidUpdateDownloadStore.fail(Str.updateDownloadInstallFailed) }
            finally { installing = false }
        }
    }

    private companion object { const val MAX_PACKAGE_BYTES = 1024L * 1024 * 1024 }
}
