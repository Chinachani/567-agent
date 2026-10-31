package org.agent567.android.core.error

internal fun isContextLimitError(error: Throwable): Boolean {
    val api = error as? Agent567Exception.Api ?: return false
    if (api.httpStatus !in 400..499) return false
    val message = api.message.lowercase()
    return "maximum context length" in message || "context_length_exceeded" in message ||
        "input token count exceeds" in message || "input is too long" in message ||
        "prompt is too long" in message || "too many input tokens" in message
}
