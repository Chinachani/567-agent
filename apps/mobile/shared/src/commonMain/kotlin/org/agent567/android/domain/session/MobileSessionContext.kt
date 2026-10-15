package org.agent567.android.domain.session

import kotlinx.serialization.Serializable

/** A context boundary changes model input, never the stored conversation. */
@Serializable
data class MobileSessionContext(
    val autoCompactionEnabled: Boolean = true,
    val throughMessageId: String? = null,
    val throughCreatedAtEpochMs: Long? = null,
    val summary: String = "",
)

data class ChatContextSnapshot(
    val tokens: Long? = null,
    val contextWindow: Long? = null,
    val estimated: Boolean = true,
    val messageCount: Int = 0,
    val autoCompactionEnabled: Boolean = true,
    val busy: Boolean = false,
    val summary: String = "",
)
