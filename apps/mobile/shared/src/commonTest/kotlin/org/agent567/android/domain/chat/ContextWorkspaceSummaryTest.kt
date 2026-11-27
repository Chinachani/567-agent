package org.agent567.android.domain.chat

import org.agent567.android.domain.session.ContextWorkspaceSnapshot
import org.agent567.android.domain.session.ContextWorkspaceTurn
import org.agent567.android.ui.chat.ContextTurnFilter
import org.agent567.android.ui.chat.filterEvaluatedContextTurns
import org.agent567.android.ui.chat.summarizeContextWorkspace
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ContextWorkspaceSummaryTest {
    private val snapshot = ContextWorkspaceSnapshot(
        sessionId = "session-1",
        revision = 1,
        documentRevision = 4,
        pinnedText = "",
        excludedTurnIds = listOf("t2"),
        summary = "Existing summary",
        previousSummary = "Earlier summary",
        totalTurns = 4,
        turns = listOf(
            ContextWorkspaceTurn("t0", "Before reset", emptyList(), "before_reset"),
            ContextWorkspaceTurn("t1", "Summarized item", emptyList(), "summarized"),
            ContextWorkspaceTurn("t2", "Excluded item", listOf("notes.txt"), "excluded"),
            ContextWorkspaceTurn("t3", "Active item", listOf("spec.md"), "included"),
        ),
    )

    @Test
    fun summaryCountsReadOnlyExcludedModifiedAndSummaryRebuild() {
        val initial = summarizeContextWorkspace(snapshot, "", listOf("t2"))
        assertEquals(1, initial.includedCount)
        assertEquals(1, initial.summarizedCount)
        assertEquals(1, initial.excludedCount)
        assertEquals(1, initial.beforeResetCount)
        assertEquals(0, initial.changeCount)
        assertFalse(initial.summaryWillRebuild)
        assertEquals(listOf("t3", "t2", "t1", "t0"), initial.evaluatedTurns.map { it.turn.id })
        assertTrue(initial.evaluatedTurns.last().isReadOnly)

        val edited = summarizeContextWorkspace(snapshot, "Pinned note", listOf("t2", "t3"))
        assertEquals(0, edited.includedCount)
        assertEquals(2, edited.excludedCount)
        assertEquals(1, edited.modifiedTurnCount)
        assertTrue(edited.pinnedChanged)
        assertEquals(2, edited.changeCount)
        assertTrue(edited.summaryWillRebuild)
    }

    @Test
    fun filterEvaluatedContextTurnsFiltersByStatusAndSearchQuery() {
        val summary = summarizeContextWorkspace(snapshot, "", listOf("t2"))
        assertEquals(listOf("t3"), filterEvaluatedContextTurns(summary.evaluatedTurns, ContextTurnFilter.Included, "").map { it.turn.id })
        assertEquals(listOf("t2"), filterEvaluatedContextTurns(summary.evaluatedTurns, ContextTurnFilter.Excluded, "").map { it.turn.id })
        assertEquals(listOf("t0"), filterEvaluatedContextTurns(summary.evaluatedTurns, ContextTurnFilter.BeforeReset, "").map { it.turn.id })
        assertEquals(listOf("t3"), filterEvaluatedContextTurns(summary.evaluatedTurns, ContextTurnFilter.All, "spec.md").map { it.turn.id })
    }
}
