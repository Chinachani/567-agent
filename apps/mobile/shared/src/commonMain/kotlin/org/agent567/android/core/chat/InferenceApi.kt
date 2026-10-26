package org.agent567.android.core.chat

enum class InferenceApi(val wireValue: String, val path: String) {
    Completions("openai-completions", "/v1/chat/completions"),
    Responses("openai-responses", "/v1/responses");

    companion object {
        fun fromWire(value: String?): InferenceApi? = entries.firstOrNull { it.wireValue == value }
        fun automatic(model: String, group: String?): InferenceApi =
            if (Regex("(?:^|[^a-z0-9])codex(?=$|[^a-z0-9])", RegexOption.IGNORE_CASE).containsMatchIn("$model ${group.orEmpty()}")) Responses else Completions
    }
}
