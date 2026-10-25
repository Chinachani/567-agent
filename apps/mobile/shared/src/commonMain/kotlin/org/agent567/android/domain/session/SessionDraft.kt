package org.agent567.android.domain.session

/** Composer state belongs to an account and a local session; it is excluded from history exports. */
data class SessionDraft(
    val text: String = "",
    val images: List<MessageImage> = emptyList(),
    val files: List<PendingFileAttachment> = emptyList(),
)

data class PendingFileAttachment(
    val id: String,
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray,
    val readScope: String = "",
)
