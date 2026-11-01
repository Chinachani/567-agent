package org.agent567.android.domain.notifications

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class TaskNotificationsTest {
    @Test fun liveBackgroundTurnsNotifyOnceWhileForegroundAndHistoryRemainQuiet() = runTest {
        var time = 0L
        val policy = TaskNotifications { time }
        val notices = mutableListOf<TaskNotice>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { policy.notices.collect(notices::add) }
        policy.needsInput("history", "old-request")
        policy.finished("history", true)
        policy.started("session", "turn-1")
        policy.needsInput("session", "question-1")
        policy.foreground = false
        policy.needsInput("session", "question-1") // foreground interaction must not replay
        assertTrue(notices.isEmpty())
        policy.needsInput("session", "question-2")
        policy.needsInput("session", "question-2")
        assertEquals(listOf(TaskNotice("session", TaskNoticeKind.NeedsInput)), notices)
        time = 30_001
        policy.finished("session")
        policy.finished("session")
        policy.interrupted("session")
        assertEquals(listOf(TaskNoticeKind.NeedsInput, TaskNoticeKind.Completed), notices.map { it.kind })
        policy.started("short", "turn-2"); policy.finished("short")
        assertEquals(2, notices.size)
        policy.started("drawing", "turn-3"); policy.finished("drawing", true)
        assertEquals(TaskNotice("drawing", TaskNoticeKind.Completed), notices.last())
        policy.started("failed", "turn-4"); policy.interrupted("failed"); policy.interrupted("failed")
        assertEquals(1, notices.count { it.kind == TaskNoticeKind.Interrupted })
        policy.started("cancelled", "turn-5"); policy.stopped("cancelled"); policy.interrupted("cancelled")
        assertEquals(1, notices.count { it.kind == TaskNoticeKind.Interrupted })
    }

    @Test fun pairedDesktopTransitionsExcludeInitialAndReconnectSnapshots() = runTest {
        var time = 0L
        val policy = TaskNotifications { time }.apply { foreground = false }
        val tracker = RemoteTaskNotifications(policy)
        val notices = mutableListOf<TaskNotice>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { policy.notices.collect(notices::add) }
        tracker.observe("desktop-session", "waiting")
        assertTrue(notices.isEmpty())
        tracker.observe("desktop-session", "running")
        tracker.observe("desktop-session", "waiting")
        tracker.observe("desktop-session", "waiting")
        // The initial snapshot stays quiet; a later distinct waiting transition is new input.
        tracker.observe("desktop-session", "idle")
        tracker.observe("desktop-session", "running")
        tracker.observe("desktop-session", "waiting")
        assertEquals(TaskNoticeKind.NeedsInput, notices.last().kind)
        tracker.observe("desktop-session", "running")
        time = 31_000
        tracker.observe("desktop-session", "idle")
        assertEquals(TaskNoticeKind.Completed, notices.last().kind)
        tracker.retain(emptySet())
        tracker.observe("desktop-session", "failed")
        assertEquals(3, notices.size)
    }
}
