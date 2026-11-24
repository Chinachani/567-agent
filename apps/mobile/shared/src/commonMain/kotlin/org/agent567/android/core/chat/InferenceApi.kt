package org.agent567.android.core.chat

enum class InferenceApi(val wireValue: String, val path: String) {
    Completions("openai-completions", "/v1/chat/completions"),
    Responses("openai-responses", "/v1/responses");

    companion object {
        fun fromWire(value: String?): InferenceApi? = entries.firstOrNull { it.wireValue == value }
        val DefaultChat: InferenceApi = Responses
    }
}
