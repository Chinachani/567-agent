package org.agent567.android.domain.session

import kotlinx.serialization.Serializable

@Serializable
data class ContextWorkspaceTurn(val id: String, val text: String, val attachments: List<String> = emptyList(), val status: String = "included")

@Serializable
data class ContextWorkspaceSnapshot(
    val sessionId: String,
    val revision: Long = 0,
    val documentRevision: Long = 0,
    val pinnedText: String = "",
    val excludedTurnIds: List<String> = emptyList(),
    val busy: Boolean = false,
    val summary: String = "",
    val previousSummary: String = "",
    val tokensBefore: Long? = null,
    val totalTurns: Int = 0,
    val turns: List<ContextWorkspaceTurn> = emptyList(),
)
