package org.agent567.android.ui

import android.content.ActivityNotFoundException
import android.content.ContextWrapper
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.domain.session.*
import org.agent567.android.ui.chat.SessionWorkbenchDialog
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.*

@RunWith(AndroidJUnit4::class)
class WorkbenchFileOpeningTest {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Test fun switchingFromDesktopCollaborationToCloudRestoresAValidContextTab() {
        val desktop = mutableStateOf(true)
        rule.setContent { Agent567Theme(ThemeMode.Dark) {
            SessionWorkbenchDialog(desktop = desktop.value, context = null, snapshot = SessionWorkbenchSnapshot(), collaboration = null,
                collaborationLoading = false, collaborationError = null, detail = null, messages = emptyList(), pendingFiles = emptyList(), pendingImages = emptyList(),
                busy = false, loading = false, error = null, onSaveContext = {}, onRefresh = {}, onRefreshCollaboration = {}, onControlCollaboration = {},
                onSelect = { _, _ -> }, onScope = { _, _ -> }, onRemoveFile = {}, onRemoveImage = {}, readOriginal = { byteArrayOf() }, readThumbnail = { null }, onDismiss = {})
        } }
        rule.onNodeWithText(Str.collaborationTitle).performClick()
        rule.runOnIdle { desktop.value = false }
        rule.onNodeWithText(Str.collaborationTitle).assertDoesNotExist()
        rule.onNodeWithText(Str.contextSendFirst).assertIsDisplayed()
        rule.onNodeWithText(Str.workbenchChanges).performClick()
        rule.onNodeWithText(Str.contextSendFirst).assertDoesNotExist()
    }

    @Test fun pendingTextRemainsReadableAndOpensTheOriginalThroughAReadOnlyUri() {
        val bytes = "编号,名称\n00042,中文".encodeToByteArray()
        val intents = mutableListOf<Intent>()
        val context = object : ContextWrapper(rule.activity) {
            override fun startActivity(intent: Intent) { intents.add(intent) }
        }
        rule.setContent { CompositionLocalProvider(LocalContext provides context) { Agent567Theme(ThemeMode.Dark) {
            SessionWorkbenchDialog(desktop = true, context = null, snapshot = SessionWorkbenchSnapshot(), collaboration = null,
                collaborationLoading = false, collaborationError = null, detail = null, messages = emptyList(),
                pendingFiles = listOf(PendingFileAttachment("pending", "sample.csv", "application/octet-stream", bytes)), pendingImages = emptyList(),
                busy = false, loading = false, error = null, onSaveContext = {}, onRefresh = {}, onRefreshCollaboration = {},
                onControlCollaboration = {}, onSelect = { _, _ -> }, onScope = { _, _ -> }, onRemoveFile = {}, onRemoveImage = {},
                readOriginal = { error("Pending preview must use the actual pending bytes") }, readThumbnail = { null }, onDismiss = {})
        } } }
        rule.onNodeWithText(Str.workbenchAttachments).performClick()
        rule.onNodeWithText("sample.csv · ${bytes.size} bytes").performClick()
        rule.onNodeWithText("编号,名称\n00042,中文").assertIsDisplayed()
        rule.onNodeWithText(Str.workbenchOpenOriginal).performClick()
        rule.waitUntil { intents.isNotEmpty() }
        val intent = intents.single()
        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertEquals("text/csv", intent.type)
        assertEquals("content", intent.data?.scheme)
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertEquals(0, intent.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        assertContentEquals(bytes, context.contentResolver.openInputStream(requireNotNull(intent.data))!!.use { it.readBytes() })
    }

    @Test fun remoteBinaryFileIsFetchedOnlyOnOpenAndMissingViewerShowsAnActionableError() {
        var reads = 0
        val detail = mutableStateOf<SessionWorkbenchDetail?>(null)
        val context = object : ContextWrapper(rule.activity) {
            override fun startActivity(intent: Intent) { throw ActivityNotFoundException() }
        }
        rule.setContent { CompositionLocalProvider(LocalContext provides context) { Agent567Theme(ThemeMode.Dark) {
            SessionWorkbenchDialog(desktop = true, context = null, snapshot = SessionWorkbenchSnapshot(attachments = listOf(SessionAttachmentAsset("remote", "report.pdf", "/work/report.pdf", "file"))),
                collaboration = null, collaborationLoading = false, collaborationError = null, detail = detail.value, messages = emptyList(), pendingFiles = emptyList(), pendingImages = emptyList(),
                busy = false, loading = false, error = null, onSaveContext = {}, onRefresh = {}, onRefreshCollaboration = {}, onControlCollaboration = {},
                onSelect = { _, _ -> detail.value = SessionWorkbenchDetail("attachment", "remote", "report.pdf", "", sizeBytes = 16, previewStatus = "binary") },
                onScope = { _, _ -> }, onRemoveFile = {}, onRemoveImage = {}, readOriginal = { reads++; "%PDF-1.4\n%%EOF".encodeToByteArray() }, readThumbnail = { null }, onDismiss = {})
        } } }
        rule.onNodeWithText(Str.workbenchAttachments).performClick()
        rule.onNodeWithText("report.pdf").performClick()
        rule.onNodeWithText(Str.workbenchBinaryPreview).assertIsDisplayed()
        assertEquals(0, reads)
        rule.onNodeWithText(Str.workbenchOpenOriginal).performClick()
        rule.waitUntil { rule.onAllNodesWithText(Str.workbenchNoViewer).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithText(Str.workbenchNoViewer).assertExists()
        assertEquals(1, reads)
        rule.onNodeWithText(Str.workbenchOpenOriginal).assertIsEnabled()
    }
}
