package org.agent567.android.ui.media

import androidx.compose.runtime.Composable

/** The caller supplies bytes only after the user selects a destination. */
@Composable
expect fun rememberOriginalAttachmentSaver(load: suspend (String) -> ByteArray, onResult: (String?) -> Unit): (id: String, name: String) -> Unit
