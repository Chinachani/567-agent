package org.agent567.android.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.agent567.android.app.ThemeMode
import org.agent567.android.domain.session.ContextWorkspaceSnapshot
import org.agent567.android.domain.session.ContextWorkspaceTurn
import org.agent567.android.domain.session.SessionChangeAsset
import org.agent567.android.domain.session.SessionTaskAsset
import org.agent567.android.domain.session.SessionWorkbenchDetail
import org.agent567.android.domain.session.SessionWorkbenchSnapshot
import org.agent567.android.ui.chat.SessionWorkbenchDialog
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.Agent567Theme
import org.junit.Rule
import org.junit.runner.RunWith
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(AndroidJUnit4::class)
class SessionWorkbenchUiTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private fun makeContext(busy: Boolean = false) = ContextWorkspaceSnapshot(
        sessionId = "s1",
        revision = 1,
        documentRevision = 3,
        pinnedText = "",
        excludedTurnIds = listOf("t2"),
        busy = busy,
        summary = "Prior summary",
        totalTurns = 3,
        turns = listOf(
            ContextWorkspaceTurn("t1", "Old turn before reset", emptyList(), "before_reset"),
            ContextWorkspaceTurn("t2", "Excluded turn text", emptyList(), "excluded"),
            ContextWorkspaceTurn("t3", "Included turn text", listOf("readme.md"), "included"),
        ),
    )

    @Test
    fun displaysNextSendSummaryExpandableTurnsUnsavedStatusAndChangeBadges() {
        var savedContext by mutableStateOf<ContextWorkspaceSnapshot?>(null)
        rule.setContent {
            Agent567Theme(ThemeMode.Dark) {
                SessionWorkbenchDialog(
                    desktop = true,
                    context = makeContext(),
                    snapshot = SessionWorkbenchSnapshot(
                        changes = listOf(SessionChangeAsset("c1", "src/Main.kt", "pending", reversible = true)),
                    ),
                    collaboration = null,
                    collaborationLoading = false,
                    collaborationError = null,
                    detail = null,
                    messages = emptyList(),
                    pendingFiles = emptyList(),
                    pendingImages = emptyList(),
                    busy = false,
                    loading = false,
                    error = null,
                    onSaveContext = { savedContext = it },
                    onRefresh = {},
                    onRefreshCollaboration = {},
                    onControlCollaboration = {},
                    onSelect = { _, _ -> },
                    onScope = { _, _ -> },
                    onRemoveFile = {},
                    onRemoveImage = {},
                    readOriginal = { byteArrayOf() },
                    readThumbnail = { null },
                    onDismiss = {},
                )
            }
        }

        rule.onNodeWithText(Str.contextNextSendTitle).assertIsDisplayed()
        rule.onNodeWithText(Str.contextSyncedBadge).assertIsDisplayed()
        rule.onNodeWithText(Str.contextSaveImpact).assertIsDisplayed()

        // Collapsed turns do not show pin button until expanded.
        rule.onNodeWithText(Str.contextPinPreview).assertDoesNotExist()
        rule.onNodeWithText(Str.expand).performScrollTo().performClick()
        rule.onNodeWithText(Str.contextPinPreview).performScrollTo().assertIsDisplayed()

        // Save starts disabled until draft becomes dirty.
        rule.onNodeWithText(Str.contextSaveSelection).assertIsNotEnabled()
        rule.onNodeWithText(Str.contextPinPreview).performClick()
        rule.onNodeWithText(Str.contextUnsavedBadge).assertIsDisplayed()
        rule.onNodeWithText(Str.contextSaveSelection).assertIsEnabled().performClick()
        assertEquals("Included turn text", savedContext?.pinnedText)

        // Changes tab exposes review status and desktop-reversible badge.
        rule.onNodeWithText(Str.workbenchChanges).performClick()
        rule.onNodeWithText(Str.workbenchPendingReview).assertIsDisplayed()
        rule.onNodeWithText(Str.workbenchReversibleDesktop).assertIsDisplayed()
    }

    @Test
    fun busyContextShowsReadOnlyStatusAndDisablesSave() {
        rule.setContent {
            Agent567Theme(ThemeMode.Light) {
                SessionWorkbenchDialog(
                    desktop = false,
                    context = makeContext(busy = true),
                    snapshot = SessionWorkbenchSnapshot(),
                    collaboration = null,
                    collaborationLoading = false,
                    collaborationError = null,
                    detail = null,
                    messages = emptyList(),
                    pendingFiles = emptyList(),
                    pendingImages = emptyList(),
                    busy = false,
                    loading = false,
                    error = null,
                    onSaveContext = {},
                    onRefresh = {},
                    onRefreshCollaboration = {},
                    onControlCollaboration = {},
                    onSelect = { _, _ -> },
                    onScope = { _, _ -> },
                    onRemoveFile = {},
                    onRemoveImage = {},
                    readOriginal = { byteArrayOf() },
                    readThumbnail = { null },
                    onDismiss = {},
                )
            }
        }

        rule.onNodeWithText(Str.workbenchReadOnly).assertIsDisplayed()
        rule.onNodeWithText(Str.contextSaveSelection).assertIsNotEnabled()
    }

    @Test
    fun supportsFilterResetTaskEmptyNoticeCollapsibleSnapshotsAndFilesFooter() {
        var detail by mutableStateOf<SessionWorkbenchDetail?>(null)
        rule.setContent {
            Agent567Theme(ThemeMode.Light) {
                SessionWorkbenchDialog(
                    desktop = true,
                    context = makeContext(),
                    snapshot = SessionWorkbenchSnapshot(
                        tasks = listOf(SessionTaskAsset("task-1", "Run build check", "completed", 1_700_000_000_000L, durationMs = 1234L, toolCount = 2)),
                        changes = listOf(SessionChangeAsset("chg-1", "src/App.kt", "kept", reversible = true)),
                    ),
                    collaboration = null,
                    collaborationLoading = false,
                    collaborationError = null,
                    detail = detail,
                    messages = emptyList(),
                    pendingFiles = emptyList(),
                    pendingImages = emptyList(),
                    busy = false,
                    loading = false,
                    error = null,
                    onSaveContext = {},
                    onRefresh = {},
                    onRefreshCollaboration = {},
                    onControlCollaboration = {},
                    onSelect = { kind, id ->
                        detail = when (kind) {
                            "task" -> SessionWorkbenchDetail("task", id, "Run build check", "")
                            "change" -> SessionWorkbenchDetail("change", id, "src/App.kt", "@@ -1 +1 @@\n-old\n+new", beforeText = "before snapshot", afterText = "after snapshot", reversible = true)
                            else -> null
                        }
                    },
                    onScope = { _, _ -> },
                    onRemoveFile = {},
                    onRemoveImage = {},
                    readOriginal = { byteArrayOf() },
                    readThumbnail = { null },
                    onDismiss = {},
                )
            }
        }

        rule.onNodeWithText(Str.contextSearchTurns).performScrollTo().performTextInput("nomatch-query")
        rule.onNodeWithText(Str.contextResetFilter).performScrollTo().performClick()
        rule.onNodeWithText("Included turn text", substring = true).performScrollTo().assertIsDisplayed()

        rule.onNodeWithText(Str.workbenchTasks).performClick()
        rule.onNodeWithText("1.2s", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Run build check").performClick()
        rule.onNodeWithText(Str.workbenchTaskNoOutput).assertIsDisplayed()
        rule.onNodeWithText(Str.close).performClick()

        rule.onNodeWithText(Str.workbenchChanges).performClick()
        rule.onNodeWithText("src/App.kt").performClick()
        rule.onNodeWithText(Str.workbenchKeptReview).assertIsDisplayed()
        rule.onNodeWithText(Str.workbenchDiffPreview).assertIsDisplayed()
        rule.onNodeWithText("before snapshot").assertDoesNotExist()
        rule.onNodeWithText(Str.workbenchBefore).performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(Str.close).performClick()

        rule.onNodeWithText(Str.sessionFiles).performClick()
        rule.onNodeWithText(Str.contextRefresh).assertDoesNotExist()
    }
}
