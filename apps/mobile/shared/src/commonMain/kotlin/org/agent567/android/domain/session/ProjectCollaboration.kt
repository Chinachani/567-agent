package org.agent567.android.domain.session

import kotlinx.serialization.Serializable

@Serializable
data class ProjectCollaborationMember(
    val sessionId: String,
    val responsibility: String,
    val access: String,
)

@Serializable
data class ProjectCollaborationConfig(
    val schemaVersion: Int,
    val revision: Int,
    val enabled: Boolean,
    val paused: Boolean,
    val coordinatorSessionId: String? = null,
    val members: List<ProjectCollaborationMember> = emptyList(),
)

@Serializable
data class ProjectCollaborationCandidate(
    val sessionId: String,
    val path: String,
    val title: String,
    val preview: String,
    val modifiedAt: Long,
    val model: String? = null,
    val state: String,
)

@Serializable
data class ProjectCollaborationTask(
    val id: String,
    val rootId: String,
    val parentId: String? = null,
    val requestKey: String,
    val sourceSessionId: String,
    val targetSessionId: String,
    val kind: String,
    val access: String,
    val objective: String,
    val status: String,
    val createdAt: Long,
    val startedAt: Long? = null,
    val finishedAt: Long? = null,
    val result: String? = null,
    val error: String? = null,
    val reviewRound: Int,
)

@Serializable
data class ProjectCollaborationSnapshot(
    val cwd: String,
    val config: ProjectCollaborationConfig,
    val candidates: List<ProjectCollaborationCandidate> = emptyList(),
    val tasks: List<ProjectCollaborationTask> = emptyList(),
)

@Serializable
data class ProjectCollaborationPatch(
    val revision: Int,
    val enabled: Boolean? = null,
    val paused: Boolean? = null,
    val coordinatorSessionId: String? = null,
    val members: List<ProjectCollaborationMember>? = null,
)

@Serializable
data class ProjectCollaborationControl(
    val action: String,
    val taskId: String? = null,
)
