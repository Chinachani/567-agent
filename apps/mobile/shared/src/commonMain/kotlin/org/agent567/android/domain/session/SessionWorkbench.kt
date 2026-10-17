package org.agent567.android.domain.session

import kotlinx.serialization.Serializable

@Serializable
data class SessionAttachmentAsset(val id: String, val name: String, val path: String, val kind: String)
@Serializable
data class SessionTaskAsset(val id: String, val title: String, val status: String, val timestamp: Long, val durationMs: Long? = null, val toolCount: Int = 0)
@Serializable
data class SessionChangeAsset(val id: String, val path: String, val status: String, val reversible: Boolean = false)
@Serializable
data class SessionWorkbenchSnapshot(val attachments: List<SessionAttachmentAsset> = emptyList(), val tasks: List<SessionTaskAsset> = emptyList(), val changes: List<SessionChangeAsset> = emptyList())
@Serializable
data class SessionWorkbenchDetail(val kind: String, val id: String, val title: String, val text: String, val path: String? = null, val sizeBytes: Long? = null, val previewStatus: String? = null, val beforeText: String? = null, val afterText: String? = null, val afterRevision: String? = null, val reversible: Boolean = false)
