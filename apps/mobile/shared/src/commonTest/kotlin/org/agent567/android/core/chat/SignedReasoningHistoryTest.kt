package org.agent567.android.core.chat

import org.agent567.android.core.error.Agent567Exception
import org.agent567.android.core.model.AssistantReplayState
import org.agent567.android.core.model.ChatContentPart
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatToolCall
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SignedReasoningHistoryTest {
    private fun signedItem(id: String, secret: String): String =
        """{"type":"reasoning","id":"$id","encrypted_content":"$secret","summary":[{"type":"summary_text","text":"step"}]}"""

    private val target = ResponsesReplayTarget(
        serviceIdentity = "https://api.567.wiki",
        groupName = "vip",
        modelId = "gpt-5",
        inferenceApi = InferenceApi.Responses,
    )

    @Test
    fun targetMatchingNormalizesGroupAndIsolatesModelSourceAndProtocol() {
        val state = AssistantReplayState(
            inferenceApi = InferenceApi.Responses.wireValue,
            serviceIdentity = "https://api.567.wiki",
            groupName = " vip ",
            modelId = "gpt-5",
            reasoningItems = listOf(signedItem("rs_1", "enc_1")),
        )
        assertTrue(isSameModelAndSource(state, target))
        assertTrue(
            isSameModelAndSource(
                state.copy(groupName = "  "),
                target.copy(groupName = null),
            ),
        )
        assertFalse(isSameModelAndSource(state, target.copy(modelId = "gpt-5-mini")))
        assertFalse(isSameModelAndSource(state, target.copy(groupName = "default")))
        assertFalse(isSameModelAndSource(state, target.copy(serviceIdentity = "https://custom.example.com")))
        assertFalse(isSameModelAndSource(state, target.copy(inferenceApi = InferenceApi.Completions)))
        assertFalse(isSameModelAndSource(state.copy(inferenceApi = InferenceApi.Completions.wireValue), target))
    }

    @Test
    fun projectionRespectsLatestResetBoundaryWithoutDroppingNewerOrOtherModelState() {
        val messages = listOf(
            ChatMessage(ChatRole.User, "q1"),
            ChatMessage(
                role = ChatRole.Assistant,
                parts = listOf(ChatContentPart.Text("a1")),
                replayState = AssistantReplayState(
                    inferenceApi = InferenceApi.Responses.wireValue,
                    serviceIdentity = "https://api.567.wiki",
                    groupName = "vip",
                    modelId = "gpt-5",
                    reasoningItems = listOf(signedItem("rs_old", "enc_old")),
                    toolCalls = listOf(ChatToolCall("call_1|fc_1", "lookup", "{}")),
                ),
            ),
            ChatMessage(
                role = ChatRole.Assistant,
                parts = listOf(ChatContentPart.Text("other")),
                replayState = AssistantReplayState(
                    inferenceApi = InferenceApi.Responses.wireValue,
                    serviceIdentity = "https://api.567.wiki",
                    groupName = "vip",
                    modelId = "gpt-5-mini",
                    reasoningItems = listOf(signedItem("rs_other", "enc_other")),
                ),
            ),
            ChatMessage(ChatRole.User, "q2"),
            ChatMessage(
                role = ChatRole.Assistant,
                parts = listOf(ChatContentPart.Text("a2")),
                replayState = AssistantReplayState(
                    inferenceApi = InferenceApi.Responses.wireValue,
                    serviceIdentity = "https://api.567.wiki",
                    groupName = "vip",
                    modelId = "gpt-5",
                    reasoningItems = listOf(signedItem("rs_new", "enc_new")),
                    signedReasoningReset = true,
                ),
            ),
        )

        val projected = projectSignedReasoningHistory(messages, target)
        assertEquals(emptyList(), projected[1].replayState?.reasoningItems)
        assertEquals(1, projected[1].replayState?.toolCalls?.size)
        assertEquals(1, projected[2].replayState?.reasoningItems?.size)
        assertEquals(1, projected[4].replayState?.reasoningItems?.size)
        assertTrue(hasSignedReasoningForTarget(projected, target))
        assertFalse(hasSignedReasoningForTarget(omitSignedReasoningHistory(projected, target), target))
    }

    @Test
    fun signatureRejectionMatcherCoversHttp400AndStreamErrorWithoutFalsePositives() {
        assertTrue(
            isResponsesSignatureRejection(
                Agent567Exception.Api(400, null, "bad", providerCode = "invalid_encrypted_content"),
                fromResponsesStreamError = false,
            ),
        )
        assertTrue(
            isResponsesSignatureRejection(
                Agent567Exception.Api(400, null, "The `encrypted_content` could not be verified."),
                fromResponsesStreamError = false,
            ),
        )
        assertTrue(
            isResponsesSignatureRejection(
                Agent567Exception.Api(400, null, "Encrypted content has expired"),
                fromResponsesStreamError = false,
            ),
        )
        assertFalse(
            isResponsesSignatureRejection(
                Agent567Exception.Api(500, null, "invalid_encrypted_content", providerCode = "invalid_encrypted_content"),
                fromResponsesStreamError = false,
            ),
        )
        assertFalse(
            isResponsesSignatureRejection(
                Agent567Exception.Api(400, null, "Unsupported parameter"),
                fromResponsesStreamError = false,
            ),
        )
        assertTrue(
            isResponsesSignatureRejection(
                Agent567Exception.Protocol("failed", providerCode = "invalid_encrypted_content"),
                fromResponsesStreamError = true,
            ),
        )
        assertFalse(
            isResponsesSignatureRejection(
                Agent567Exception.Protocol("failed", providerCode = "invalid_encrypted_content"),
                fromResponsesStreamError = false,
            ),
        )
    }

    @Test
    fun replayStateToStringRedactsEncryptedContent() {
        val secret = "SUPER_SECRET_CIPHERTEXT_999"
        val state = AssistantReplayState(
            inferenceApi = InferenceApi.Responses.wireValue,
            serviceIdentity = "https://api.567.wiki",
            groupName = "vip",
            modelId = "gpt-5",
            reasoningItems = listOf(signedItem("rs_1", secret)),
            signedReasoningReset = true,
        )
        val rendered = state.toString()
        assertFalse(rendered.contains(secret), rendered)
        assertTrue(rendered.contains("reasoningCount=1"), rendered)
        assertTrue(rendered.contains("signedReasoningReset=true"), rendered)
    }
}
