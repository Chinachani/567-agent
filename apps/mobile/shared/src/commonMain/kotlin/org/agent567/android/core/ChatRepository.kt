package org.agent567.android.core

import kotlinx.coroutines.flow.Flow
import org.agent567.android.core.api.Agent567Api
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatStreamEvent

class ChatRepository internal constructor(
    private val api: Agent567Api,
) {
    fun stream(
        model: String,
        messages: List<ChatMessage>,
        temperature: Double? = null,
        groupName: String? = null,
        imageGenModel: String? = null,
    ): Flow<ChatStreamEvent> = api.streamChat(model, messages, temperature, groupName, imageGenModel)
}
