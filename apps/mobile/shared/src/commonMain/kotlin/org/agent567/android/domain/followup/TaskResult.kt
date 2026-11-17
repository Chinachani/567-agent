package org.agent567.android.domain.followup

import kotlinx.serialization.Serializable

@Serializable
data class TaskResult(
    val sessionId: String,
    val taskId: String,
    val title: String,
    val startedAt: Long,
    val endedAt: Long? = null,
    val status: String,
    val open: Boolean,
    val deviceId: String? = null,
    val read: Boolean = false,
) {
    val key: String get() = "${deviceId.orEmpty().length}:${deviceId.orEmpty()}:${sessionId.length}:$sessionId:$taskId"
    val revision: String get() = "$status:${endedAt ?: "open"}"
}

@Serializable
data class TaskResultSnapshot(
    val tasks: List<TaskResult>,
    val unavailableCount: Int = 0,
    val truncated: Boolean = false,
)
