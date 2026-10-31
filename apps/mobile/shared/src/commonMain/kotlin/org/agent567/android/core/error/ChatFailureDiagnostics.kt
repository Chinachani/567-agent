package org.agent567.android.core.error

internal enum class ChatFailureStage { Chat, Image }

/** Retain enough metadata for ADB diagnosis without prompts, image bytes, keys or server bodies. */
internal fun chatFailureDiagnostic(stage: ChatFailureStage, error: Throwable): String = buildString {
    append("request_failed stage=").append(stage.name.lowercase())
    append(" type=").append(error::class.simpleName ?: "Unknown")
    if (isContextLimitError(error)) append(" category=context_limit")
    if (error is ImagePayloadException) append(" imagePayload=").append(error.problem.name.lowercase())
    (error as? Agent567Exception.Api)?.let {
        append(" httpStatus=").append(it.httpStatus)
        it.code?.let { code -> append(" code=").append(code) }
    }
}

internal expect fun recordChatFailure(stage: ChatFailureStage, error: Throwable)
