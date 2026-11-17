package org.agent567.android.domain.followup

import org.agent567.android.core.model.ChatRole
import org.agent567.android.domain.session.ConversationOrigin
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.domain.session.SessionStore

suspend fun readLocalTaskResults(store: SessionStore, running: Set<String>): List<TaskResult> {
    val output = mutableListOf<TaskResult>()
    for (session in store.sessions.value.filter { it.origin == ConversationOrigin.Cloud }.sortedByDescending { it.updatedAtEpochMs }.take(200)) {
        var taskId: String? = null
        var startedAt = 0L
        val tasks = linkedMapOf<String, TaskResult>()
        for (message in store.getMessages(session.id)) {
            if (message.role == ChatRole.User) {
                taskId = message.id; startedAt = message.createdAtEpochMs
                tasks[message.id] = TaskResult(session.id, message.id, session.title, startedAt, status = "unknown", open = true)
            }
            val id = taskId ?: continue
            if (message.role != ChatRole.Assistant) continue
            val status = when (message.status) {
                MessageStatus.Complete -> "completed"
                MessageStatus.Error -> "failed"
                MessageStatus.Aborted -> "cancelled"
                else -> "unknown"
            }
            val open = message.status in setOf(MessageStatus.Streaming, MessageStatus.Pending)
            tasks[id] = TaskResult(session.id, id, session.title, startedAt,
                if (open) null else message.createdAtEpochMs + (message.processingDurationMs ?: 0L), status, open)
        }
        if (session.id in running) tasks.keys.lastOrNull()?.let { id ->
            val last = tasks.getValue(id)
            if (last.open) tasks[id] = last.copy(status = "running", open = true, endedAt = null)
            else if (last.status != "completed") tasks.remove(id)
        }
        output += tasks.values
    }
    return output.sortedByDescending { it.endedAt ?: it.startedAt }.take(200)
}
