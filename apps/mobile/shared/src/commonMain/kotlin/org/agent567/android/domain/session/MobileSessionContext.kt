package org.agent567.android.domain.session

import kotlinx.serialization.Serializable

/** A context boundary changes model input, never the stored conversation. */
@Serializable
data class MobileSessionContext(
    val autoCompactionEnabled: Boolean = true,
    val throughMessageId: String? = null,
    val throughCreatedAtEpochMs: Long? = null,
    val summary: String = "",
    val previousSummary: String = "",
    val pinnedText: String = "",
    val excludedTurnIds: List<String> = emptyList(),
    val selectionRevision: Long = 0,
)

data class ChatContextSnapshot(
    val workspace: ContextWorkspaceSnapshot? = null,
    val tokens: Long? = null,
    val contextWindow: Long? = null,
    val contextWindowSource: String = "unknown",
    val manualContextWindow: Long? = null,
    val modelKey: String? = null,
    val modelName: String? = null,
    val automaticContextWindow: Long? = null,
    val referenceModel: String? = null,
    val referenceUrl: String? = null,
    val referenceCheckedAt: String? = null,
    val referenceIsAlias: Boolean = false,
    val referenceContextWindow: Long? = null,
    val referenceMaxOutput: Long? = null,
    val referenceMaxInput: Long? = null,
    val referenceCapabilities: org.agent567.android.core.model.ModelReferenceCapabilities? = null,
    val estimated: Boolean = true,
    val messageCount: Int = 0,
    val autoCompactionEnabled: Boolean = true,
    val busy: Boolean = false,
    val summary: String = "",
)
