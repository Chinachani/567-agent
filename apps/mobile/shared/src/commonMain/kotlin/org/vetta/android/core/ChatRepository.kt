package org.vetta.android.core

import kotlinx.coroutines.flow.Flow
import org.vetta.android.core.api.VettaApi
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatStreamEvent

class ChatRepository internal constructor(
    private val api: VettaApi,
) {
    fun stream(
        model: String,
        messages: List<ChatMessage>,
        temperature: Double? = null,
        groupName: String? = null,
        imageGenModel: String? = null,
    ): Flow<ChatStreamEvent> = api.streamChat(model, messages, temperature, groupName, imageGenModel)
}
