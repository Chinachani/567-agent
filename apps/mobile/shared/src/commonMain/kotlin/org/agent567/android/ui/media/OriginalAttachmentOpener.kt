package org.agent567.android.ui.media

import androidx.compose.runtime.Composable

data class OriginalAttachmentOpener(val opening: Boolean, val open: (id: String, name: String) -> Unit)

/** Reading and sharing happen only after the user explicitly chooses Open. */
@Composable
expect fun rememberOriginalAttachmentOpener(load: suspend (String) -> ByteArray, onResult: (String?) -> Unit): OriginalAttachmentOpener
