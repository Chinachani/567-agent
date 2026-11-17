package org.agent567.android

import android.content.Intent
import android.net.Uri
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import org.agent567.android.domain.session.MAX_PENDING_SHARES
import org.agent567.android.domain.session.MAX_SHARED_TEXT_CHARACTERS
import org.agent567.android.domain.session.SharedDraftContent
import org.agent567.android.domain.session.PendingFileAttachment
import org.agent567.android.ui.media.readGrantedFileAttachments
import org.agent567.android.ui.i18n.Str
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.tooling.preview.Preview
import org.agent567.android.app.ThemeMode

class MainActivity : ComponentActivity() {
    private var pendingTaskSession by mutableStateOf<String?>(null)
    private var pendingTaskAction by mutableStateOf<String?>(null)
    private var pendingSharedContent by mutableStateOf<SharedDraftContent?>(null)
    private var readingShare = false
    private val shareQueue = ArrayDeque<Pair<Long, Intent>>()
    private var readJob: kotlinx.coroutines.Job? = null
    private var readingEpoch: Long? = null
    private val appContainer get() = (application as Agent567Application).appContainer
    private var pendingPairingInvite by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as Agent567Application).appContainer
        val savedMode = container.preferences.themeMode.value
        val systemDark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val dark = when (savedMode) {
            ThemeMode.Dark -> true
            ThemeMode.Light -> false
            ThemeMode.System -> systemDark
        }
        window.setBackgroundDrawable(ColorDrawable(if (dark) Color.rgb(18, 18, 18) else Color.rgb(248, 248, 248)))
        pendingPairingInvite = pairingInviteFrom(intent)
        pendingTaskSession = intent.getStringExtra(org.agent567.android.ui.notifications.TASK_NOTIFICATION_SESSION_EXTRA)?.takeIf { it.isNotBlank() && it.length <= 256 }
        pendingTaskAction = intent.getStringExtra(org.agent567.android.ui.notifications.TASK_NOTIFICATION_ACTION_EXTRA)?.takeIf { it.length <= 32 }
        lifecycleScope.launch {
            container.sharedContentEpoch.collect { epoch ->
                shareQueue.removeAll { it.first != epoch }
                pendingSharedContent = pendingSharedContent?.takeIf { it.epoch == epoch }
                if (readingEpoch != null && readingEpoch != epoch) readJob?.cancel()
                readNextShare()
            }
        }
        receiveShare(intent)

        setContent {
            App(
                container = container,
                pairingInvite = pendingPairingInvite,
                onPairingInviteHandled = ::clearHandledPairingInvite,
                notificationSessionId = pendingTaskSession,
                notificationAction = pendingTaskAction,
                onNotificationHandled = { pendingTaskSession = null; pendingTaskAction = null; intent.removeExtra(org.agent567.android.ui.notifications.TASK_NOTIFICATION_SESSION_EXTRA); intent.removeExtra(org.agent567.android.ui.notifications.TASK_NOTIFICATION_ACTION_EXTRA) },
                sharedContent = pendingSharedContent,
                onSharedTextHandled = { id -> if (pendingSharedContent?.id == id) { pendingSharedContent = null; readNextShare() } },
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingPairingInvite = pairingInviteFrom(intent)
        pendingTaskSession = intent.getStringExtra(org.agent567.android.ui.notifications.TASK_NOTIFICATION_SESSION_EXTRA)?.takeIf { it.isNotBlank() && it.length <= 256 }
        pendingTaskAction = intent.getStringExtra(org.agent567.android.ui.notifications.TASK_NOTIFICATION_ACTION_EXTRA)?.takeIf { it.length <= 32 }
        receiveShare(intent)
    }

    private fun receiveShare(incoming: Intent) {
        if (incoming.action !in setOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return
        val pendingCount = shareQueue.size + if (readingShare || pendingSharedContent != null) 1 else 0
        if (pendingCount >= MAX_PENDING_SHARES) {
            android.widget.Toast.makeText(this, Str.shareQueueFull, android.widget.Toast.LENGTH_LONG).show()
            return
        }
        // Retain URI grants/metadata only; decode one share at a time. Never save bytes in a Bundle.
        shareQueue.addLast(appContainer.sharedContentEpoch.value to Intent(incoming))
        incoming.removeExtra(Intent.EXTRA_TEXT)
        incoming.removeExtra(Intent.EXTRA_STREAM)
        incoming.removeExtra(SHARE_TARGET_SESSION_EXTRA)
        incoming.clipData = null
        incoming.action = Intent.ACTION_MAIN
        readNextShare()
    }

    @Suppress("DEPRECATION")
    private fun readNextShare() {
        if (readingShare || pendingSharedContent != null) return
        shareQueue.removeAll { it.first != appContainer.sharedContentEpoch.value }
        if (shareQueue.isEmpty()) return
        val (epoch, incoming) = shareQueue.removeFirst()
        readingShare = true
        readingEpoch = epoch
        readJob = lifecycleScope.launch(start = kotlinx.coroutines.CoroutineStart.LAZY) {
            try {
                val rawText = incoming.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty()
                val id = java.util.UUID.randomUUID().toString()
                if (rawText.length > MAX_SHARED_TEXT_CHARACTERS) {
                    pendingSharedContent = SharedDraftContent(id, textTooLong = true, epoch = epoch)
                    return@launch
                }
                val uris = buildList {
                    if (incoming.action == Intent.ACTION_SEND_MULTIPLE) addAll(incoming.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty())
                    else incoming.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)?.let(::add)
                    incoming.clipData?.let { clip -> for (i in 0 until minOf(clip.itemCount, 11)) clip.getItemAt(i).uri?.let(::add) }
                }.distinct().take(11)
                val grant = incoming.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0
                val granted = if (grant) uris.filter { uri -> uri.scheme == "content" && checkUriPermission(uri, android.os.Process.myPid(), android.os.Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION) == android.content.pm.PackageManager.PERMISSION_GRANTED } else emptyList()
                val files = readGrantedFileAttachments(applicationContext, granted)
                if (epoch != appContainer.sharedContentEpoch.value) return@launch
                pendingSharedContent = SharedDraftContent(
                    id = id,
                    epoch = epoch,
                    text = rawText.trim(),
                    files = files.mapIndexed { index, file -> PendingFileAttachment("share-$id-$index", file.fileName, file.mimeType, file.bytes) },
                    rejected = files.size != uris.size,
                    targetSessionId = incoming.getStringExtra(SHARE_TARGET_SESSION_EXTRA)?.takeIf { it.isNotBlank() && it.length <= 256 },
                )
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { android.widget.Toast.makeText(this@MainActivity, Str.shareReadFailed, android.widget.Toast.LENGTH_LONG).show() }
            finally {
                readingShare = false
                readingEpoch = null
                readJob = null
                if (!isDestroyed) readNextShare()
            }
        }
        readJob?.start()
    }

    private fun clearHandledPairingInvite() {
        pendingPairingInvite = null
        if (pairingInviteFrom(intent) != null) {
            setIntent(Intent(intent).setData(null))
        }
    }
}

internal fun pairingInviteFrom(intent: Intent): String? {
    val data = intent.data ?: return null
    return data.toString().takeIf { (data.scheme == "vetta" || data.scheme == "agent567") && data.host == "pair" }
}

internal const val SHARE_TARGET_SESSION_EXTRA = "agent567.share.targetSession"

@Preview
@Composable
fun AppAndroidPreview() {
    App()
}
