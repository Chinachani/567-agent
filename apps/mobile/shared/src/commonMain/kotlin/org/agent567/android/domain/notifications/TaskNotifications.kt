package org.agent567.android.domain.notifications

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/** Only live turn events enter this policy. Loading history cannot create a notice. */
enum class TaskNoticeKind { NeedsInput, Completed, Interrupted }
data class TaskNotice(val sessionId: String, val kind: TaskNoticeKind)

class TaskNotifications(private val now: () -> Long = { System.currentTimeMillis() }) {
    private data class Turn(val id: String, val startedAt: Long, val sent: MutableSet<String> = mutableSetOf(), var terminal: Boolean = false)
    private val turns = mutableMapOf<String, Turn>()
    private val mutableNotices = MutableSharedFlow<TaskNotice>(extraBufferCapacity = 32)
    val notices = mutableNotices.asSharedFlow()
    var foreground: Boolean = true
    fun started(sessionId: String, turnId: String) {
        if (turns[sessionId]?.id != turnId) turns[sessionId] = Turn(turnId, now())
    }
    fun needsInput(sessionId: String, requestId: String) { emit(sessionId, TaskNoticeKind.NeedsInput, "input:$requestId") }
    fun finished(sessionId: String, imageGenerated: Boolean = false) {
        val turn = turns[sessionId] ?: return
        if (turn.terminal) return
        if (imageGenerated || now() - turn.startedAt >= 30_000) emit(sessionId, TaskNoticeKind.Completed, "terminal")
        turn.terminal = true
    }
    fun interrupted(sessionId: String) {
        val turn = turns[sessionId] ?: return
        if (!turn.terminal) emit(sessionId, TaskNoticeKind.Interrupted, "terminal")
        turn.terminal = true
    }
    fun stopped(sessionId: String) { turns.remove(sessionId) }
    fun clear() { turns.clear() }
    private fun emit(sessionId: String, kind: TaskNoticeKind, key: String) {
        val turn = turns[sessionId] ?: return
        if (turn.terminal || !turn.sent.add(key) || foreground) return
        mutableNotices.tryEmit(TaskNotice(sessionId, kind))
    }
}
