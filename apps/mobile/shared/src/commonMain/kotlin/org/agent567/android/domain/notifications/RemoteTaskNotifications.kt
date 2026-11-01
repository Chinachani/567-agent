package org.agent567.android.domain.notifications

/** Initial snapshots and reconnects establish a baseline instead of replaying old alerts. */
class RemoteTaskNotifications(private val notifications: TaskNotifications) {
    private val previous = mutableMapOf<String, String>()
    private var sequence = 0L
    fun observe(sessionId: String, status: String) {
        val before = previous.put(sessionId, status)
        if (before == status) return
        if (before == null) {
            if (status == "running" || status == "waiting") notifications.started(sessionId, "remote:${++sequence}")
            return
        }
        when (status) {
            "running" -> if (before != "waiting") notifications.started(sessionId, "remote:${++sequence}")
            "waiting" -> notifications.needsInput(sessionId, "remote:${++sequence}")
            "idle" -> notifications.finished(sessionId)
            "failed" -> notifications.interrupted(sessionId)
            "interrupted" -> notifications.stopped(sessionId)
        }
    }
    fun retain(sessionIds: Set<String>) { previous.keys.retainAll(sessionIds) }
}
