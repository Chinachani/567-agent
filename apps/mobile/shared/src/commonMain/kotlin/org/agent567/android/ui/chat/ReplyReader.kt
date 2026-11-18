package org.agent567.android.ui.chat

import androidx.compose.runtime.Composable

internal interface ReplyReader {
    val activeId: String?
    fun stop()
    fun toggle(id: String, text: String)
}

@Composable
internal expect fun rememberReplyReader(sessionId: String?, onUnavailable: () -> Unit): ReplyReader
