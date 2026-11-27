package org.agent567.android.core.chat

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import org.agent567.android.core.error.Agent567Exception
import org.agent567.android.core.model.AssistantReplayState
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.net.Agent567Json

private val ENCRYPTED_CONTENT_REGEX = Regex("\\bencrypted[ _]content\\b")
private val VERIFICATION_OR_EXPIRY_REGEX = Regex("\\b(?:could not be verified|has expired)\\b")

internal data class ResponsesReplayTarget(
    val serviceIdentity: String,
    val groupName: String? = null,
    val modelId: String,
    val inferenceApi: InferenceApi = InferenceApi.Responses,
) {
    val normalizedGroupName: String?
        get() = groupName?.trim()?.takeIf { it.isNotEmpty() }
}

internal fun isSameModelAndSource(
    state: AssistantReplayState?,
    target: ResponsesReplayTarget,
): Boolean {
    if (state == null || target.inferenceApi != InferenceApi.Responses) return false
    return state.inferenceApi == InferenceApi.Responses.wireValue &&
        state.serviceIdentity == target.serviceIdentity &&
        state.groupName?.trim()?.takeIf { it.isNotEmpty() } == target.normalizedGroupName &&
        state.modelId == target.modelId
}

internal fun parseSignedReasoningWireItem(rawJson: String): JsonObject? {
    val obj = runCatching { Agent567Json.parseToJsonElement(rawJson) as? JsonObject }.getOrNull() ?: return null
    val type = (obj["type"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    val encrypted = (obj["encrypted_content"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    return obj.takeIf { type == "reasoning" && !encrypted.isNullOrEmpty() }
}

internal fun isSignedReasoningWireItem(rawJson: String): Boolean = parseSignedReasoningWireItem(rawJson) != null

internal fun isSignedReasoningJsonObject(item: JsonObject?): Boolean {
    if (item == null) return false
    val type = (item["type"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    val encrypted = (item["encrypted_content"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
    return type == "reasoning" && !encrypted.isNullOrEmpty()
}

internal fun projectSignedReasoningHistory(
    messages: List<ChatMessage>,
    target: ResponsesReplayTarget,
): List<ChatMessage> {
    if (target.inferenceApi != InferenceApi.Responses) return messages
    for (index in messages.indices.reversed()) {
        val message = messages[index]
        if (message.role == ChatRole.Assistant &&
            isSameModelAndSource(message.replayState, target) &&
            message.replayState?.signedReasoningReset == true
        ) {
            return omitSignedReasoningHistory(messages, target, beforeIndex = index)
        }
    }
    return messages
}

internal fun omitSignedReasoningHistory(
    messages: List<ChatMessage>,
    target: ResponsesReplayTarget,
    beforeIndex: Int = messages.size,
): List<ChatMessage> {
    if (target.inferenceApi != InferenceApi.Responses || beforeIndex <= 0) return messages
    var updated: MutableList<ChatMessage>? = null
    val limit = beforeIndex.coerceAtMost(messages.size)
    for (index in 0 until limit) {
        val message = messages[index]
        val state = message.replayState ?: continue
        if (message.role != ChatRole.Assistant || !isSameModelAndSource(state, target)) continue
        if (state.reasoningItems.none(::isSignedReasoningWireItem)) continue
        if (updated == null) updated = messages.toMutableList()
        updated[index] = message.copy(replayState = state.copy(reasoningItems = emptyList()))
    }
    return updated ?: messages
}

internal fun hasSignedReasoningForTarget(
    messages: List<ChatMessage>,
    target: ResponsesReplayTarget,
): Boolean =
    target.inferenceApi == InferenceApi.Responses &&
        messages.any { message ->
            message.role == ChatRole.Assistant &&
                isSameModelAndSource(message.replayState, target) &&
                message.replayState?.reasoningItems?.any(::isSignedReasoningWireItem) == true
        }

internal fun isResponsesSignatureRejection(
    error: Throwable,
    fromResponsesStreamError: Boolean = false,
): Boolean =
    when (error) {
        is Agent567Exception.Api ->
            error.httpStatus == 400 && (
                error.providerCode == "invalid_encrypted_content" ||
                    matchesSignatureRejectionMessage(error.message)
                )
        is Agent567Exception.Protocol ->
            fromResponsesStreamError && (
                error.providerCode == "invalid_encrypted_content" ||
                    matchesSignatureRejectionMessage(error.message)
                )
        else -> false
    }

private fun matchesSignatureRejectionMessage(message: String): Boolean {
    val normalized = message.lowercase().replace("`", "")
    return ENCRYPTED_CONTENT_REGEX.containsMatchIn(normalized) &&
        VERIFICATION_OR_EXPIRY_REGEX.containsMatchIn(normalized)
}
