package org.agent567.android.domain.session

/** In-memory hand-off only. File bytes never enter an Intent or saved-state Bundle. */
data class SharedDraftContent(
    val id: String,
    val text: String = "",
    val files: List<PendingFileAttachment> = emptyList(),
    val rejected: Boolean = false,
    val textTooLong: Boolean = false,
    val epoch: Long = 0,
    val targetSessionId: String? = null,
)

const val MAX_SHARED_TEXT_CHARACTERS = 100_000
const val MAX_PENDING_SHARES = 3
