package org.agent567.android.core.api

import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.utils.io.readUTF8Line
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.random.Random
import org.agent567.android.core.chat.InferenceApi
import org.agent567.android.core.chat.OpenAiSseParser
import org.agent567.android.core.chat.OpenAiSseStreamParser
import org.agent567.android.core.chat.ResponsesSseStreamParser
import org.agent567.android.core.chat.isResponsesSignatureRejection
import org.agent567.android.core.error.Agent567Exception
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.core.model.ChatToolCall

private const val MAX_CHAT_LINE_CHARS = 1_000_000

internal data class DirectChatStreamPolicy(
    val firstEventTimeoutMs: Long = 120_000,
    val idleEventTimeoutMs: Long = 90_000,
    val emptyRetryDelayMs: Long = 250,
    val transientRetryDelayMs: Long = 400,
    val maxRetryDelayMs: Long = 60_000,
    val jitterMs: Long = 250,
) {
    fun retryDelay(kind: DirectChatRetry, retryAfterMs: Long?, random: Random = Random.Default): Long? {
        if (retryAfterMs != null && retryAfterMs > maxRetryDelayMs) return null
        val base = when (kind) {
            DirectChatRetry.Empty -> emptyRetryDelayMs
            DirectChatRetry.Transient -> transientRetryDelayMs
        }
        val minimum = maxOf(base, retryAfterMs ?: 0).coerceAtMost(maxRetryDelayMs)
        val jitterLimit = minOf(jitterMs, maxRetryDelayMs - minimum)
        return minimum + if (jitterLimit > 0) random.nextLong(jitterLimit + 1) else 0
    }
}

internal enum class DirectChatRetry { Empty, Transient }

internal sealed interface DirectChatOutcome {
    data class Complete(
        val reasoningItems: List<String> = emptyList(),
        val toolCalls: List<ChatToolCall> = emptyList(),
    ) : DirectChatOutcome {
        override fun toString(): String =
            "Complete(reasoningCount=${reasoningItems.size}, toolCalls=${toolCalls.size})"
    }

    data object RepairCredential : DirectChatOutcome
    data class Failure(
        val error: Throwable,
        val retry: DirectChatRetry? = null,
        val retryAfterMs: Long? = null,
        val signatureRejection: Boolean = false,
    ) : DirectChatOutcome
}

internal suspend fun withDirectChatDeadlines(
    policy: DirectChatStreamPolicy,
    request: suspend (markActivity: () -> Unit) -> DirectChatOutcome,
): DirectChatOutcome = coroutineScope {
    val activity = Channel<Unit>(Channel.CONFLATED)
    val attempt = async(start = CoroutineStart.LAZY) { request { activity.trySend(Unit) } }
    val watchdog = launch {
        var first = true
        while (true) {
            val timeoutMs = if (first) policy.firstEventTimeoutMs else policy.idleEventTimeoutMs
            val arrived = withTimeoutOrNull(timeoutMs) { activity.receive() }
            if (arrived == null) {
                attempt.cancel(ChatDeadlineCancellation(first))
                return@launch
            }
            first = false
        }
    }
    try {
        attempt.await()
    } catch (expired: ChatDeadlineCancellation) {
        DirectChatOutcome.Failure(Agent567Exception.Network(
            if (expired.waitingForFirst) "等待模型响应超时，请重试" else "模型长时间未发送新内容，已保留收到的回复",
        ))
    } finally {
        watchdog.cancel()
    }
}

private class ChatDeadlineCancellation(val waitingForFirst: Boolean) : CancellationException("Direct chat deadline expired")

internal suspend fun readDirectChatResponse(
    response: HttpResponse,
    inferenceApi: InferenceApi,
    markActivity: () -> Unit,
    send: suspend (ChatStreamEvent) -> Unit,
): DirectChatOutcome {
    val channel = response.bodyAsChannel()
    val completions = if (inferenceApi == InferenceApi.Completions) OpenAiSseStreamParser() else null
    val responses = if (inferenceApi == InferenceApi.Responses) ResponsesSseStreamParser() else null
    val nonStream = StringBuilder()
    var sawSse = false
    var replayUnsafe = false
    var sawFinish = false
    var sawOutput = false
    var endedByLimit = false

    fun completedResponse(): DirectChatOutcome = when {
        sawOutput || endedByLimit -> DirectChatOutcome.Complete(
            reasoningItems = responses?.completedReasoningItems().orEmpty(),
            toolCalls = responses?.completedToolCalls().orEmpty(),
        )
        replayUnsafe -> noChatContent()
        else -> emptyChatResponse()
    }

    suspend fun forward(events: List<ChatStreamEvent>): DirectChatOutcome? {
        for (event in events) {
            when (event) {
                is ChatStreamEvent.Error -> {
                    val signatureRejected = inferenceApi == InferenceApi.Responses &&
                        !replayUnsafe &&
                        responses?.lastFailureFromStreamError == true &&
                        isResponsesSignatureRejection(event.exception, fromResponsesStreamError = true)
                    return DirectChatOutcome.Failure(
                        error = event.exception,
                        signatureRejection = signatureRejected,
                    )
                }
                ChatStreamEvent.Done -> return completedResponse()
                is ChatStreamEvent.Delta, is ChatStreamEvent.Tool -> {
                    sawOutput = true
                    replayUnsafe = true
                }
                is ChatStreamEvent.Finished -> {
                    sawFinish = true
                    val reason = event.finishReason
                    endedByLimit = endedByLimit || reason == "length" || reason == "content_filter"
                    if (event.usage != null || (reason != null && reason != "stop")) replayUnsafe = true
                    // A bare stop can be followed by a usage frame. Keep it private until the attempt is accepted.
                    if (!replayUnsafe) continue
                }
                else -> replayUnsafe = true
            }
            markActivity()
            send(event)
        }
        return null
    }

    while (true) {
        val line = channel.readUTF8Line(MAX_CHAT_LINE_CHARS) ?: break
        if (line.length >= MAX_CHAT_LINE_CHARS) return protocolFailure("流式响应单行超过安全长度限制")
        val trimmed = line.trim()
        if (trimmed.startsWith(":")) continue
        if (trimmed.startsWith("data:") || trimmed.startsWith("event:") || trimmed.startsWith("id:") || trimmed.startsWith("retry:")) {
            sawSse = true
            nonStream.clear()
        }
        if (!sawSse && (trimmed.isNotEmpty() || nonStream.isNotEmpty())) {
            if (nonStream.length.toLong() + line.length + 1 > MAX_CHAT_LINE_CHARS) return protocolFailure("服务器返回内容过大，无法安全解析")
            nonStream.appendLine(line)
        }
        val activityBefore = completions?.toolActivityCount ?: responses?.hiddenActivityCount
        val events = completions?.parseLine(line) ?: responses!!.parseLine(line)
        if (activityBefore != (completions?.toolActivityCount ?: responses?.hiddenActivityCount)) {
            replayUnsafe = true
            markActivity()
        }
        forward(events)?.let { return it }
    }

    val finalEvents = when {
        !sawSse && nonStream.isNotBlank() -> {
            val text = nonStream.toString()
            val events = responses?.parseNonStreamJson(text) ?: OpenAiSseParser.parseNonStreamJson(text)
            if (events.isEmpty()) return protocolFailure("无法解析模型响应")
            events
        }
        sawSse -> responses?.finish().orEmpty()
        else -> emptyList()
    }
    forward(finalEvents)?.let { return it }
    if (sawFinish || (!sawSse && nonStream.isBlank())) return completedResponse()
    if (!sawSse) return noChatContent()
    return protocolFailure("流式响应意外结束，未收到完整响应标记")
}

private fun emptyChatResponse(): DirectChatOutcome.Failure =
    noChatContent().copy(retry = DirectChatRetry.Empty)

private fun noChatContent() = protocolFailure("模型返回空响应，请重试")

private fun protocolFailure(message: String) = DirectChatOutcome.Failure(Agent567Exception.Protocol(message))

internal fun chatRetryAfterMs(value: String?, wallNowMs: Long = System.currentTimeMillis()): Long? {
    val header = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    if (header.all { it in '0'..'9' }) {
        return (header.toLongOrNull() ?: Long.MAX_VALUE).coerceAtMost(Long.MAX_VALUE / 1_000) * 1_000
    }
    val position = ParsePosition(0)
    val date = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss 'GMT'", Locale.US).apply {
        isLenient = false
        timeZone = TimeZone.getTimeZone("GMT")
    }.parse(header, position)
    return date?.takeIf { position.index == header.length }?.let { (it.time - wallNowMs).coerceAtLeast(0) }
}

internal fun canRetryRejectedChatRequest(status: Int, error: Agent567Exception, retryAfterMs: Long?): Boolean {
    if (error !is Agent567Exception.Api || (status != 429 && !(status == 503 && retryAfterMs != null))) return false
    val diagnostic = (error.rawBody ?: error.message).take(4_096).lowercase()
    return listOf("insufficient_quota", "quota_exceeded", "billing", "credit", "balance", "context_length", "余额", "额度", "欠费").none(diagnostic::contains)
}
