package org.vetta.android.core.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
internal data class ApiEnvelope<T>(
    val code: Int? = null,
    val success: Boolean? = null,
    val message: String = "",
    val data: T? = null,
) {
    val isSuccessful: Boolean
        get() = success == true || (code == 0 && success != false) || (code == null && success == null && data != null)
}

@Serializable
internal data class LoginRequestDto(
    val account: String,
    val password: String,
)

@Serializable
internal data class NewApiLoginRequestDto(
    val username: String,
    val password: String,
)

@Serializable
internal data class EmailPasswordLoginRequestDto(
    val email: String,
    val password: String,
)

@Serializable
internal data class SmsLoginRequestDto(
    val phone: String,
    val code: String,
)

@Serializable
internal data class SendSmsCodeRequestDto(
    val phone: String,
)

@Serializable
internal data class RefreshTokenRequestDto(
    @SerialName("refresh_token")
    val refreshToken: String,
)

@Serializable
internal data class LogoutRequestDto(
    @SerialName("refresh_token")
    val refreshToken: String? = null,
)

@Serializable
internal data class LoginResponseDto(
    val token: String? = null,
    @SerialName("access_token")
    val accessToken: String? = null,
    @SerialName("refresh_token")
    val refreshToken: String? = null,
    @SerialName("requires_password")
    val requiresPassword: Boolean = false,
    val user: UserDto? = null,
    val id: Long = 0,
    val username: String = "",
    @SerialName("display_name")
    val displayName: String? = null,
    val quota: Long = 0,
    val role: Int = 1,
)

@Serializable
internal data class RefreshResponseDto(
    @SerialName("access_token")
    val accessToken: String,
    @SerialName("refresh_token")
    val refreshToken: String,
)

@Serializable
internal data class UserDto(
    val id: Long = 0,
    val username: String = "",
    val nickname: String = "",
    @SerialName("display_name")
    val displayName: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val avatar: String = "",
    @SerialName("is_active")
    val isActive: Boolean = true,
    @SerialName("created_at")
    val createdAt: String? = null,
    val quota: Long = 0,
    val role: Int = 1,
)

@Serializable
internal data class SubscriptionStatusDto(
    val active: Boolean,
    @SerialName("is_default")
    val isDefault: Boolean = false,
    @SerialName("go_enabled")
    val goEnabled: Boolean = false,
    @SerialName("tier_id")
    val tierId: Long? = null,
    @SerialName("tier_name")
    val tierName: String? = null,
    @SerialName("badge_text")
    val badgeText: String? = null,
    @SerialName("badge_color")
    val badgeColor: String? = null,
    val description: String? = null,
    @SerialName("expires_at")
    val expiresAt: String? = null,
    val windows: List<QuotaWindowDto> = emptyList(),
)

@Serializable
internal data class QuotaWindowDto(
    val kind: String,
    val limit: Double,
    val consumed: Double,
    @SerialName("reset_at")
    val resetAt: String? = null,
)

@Serializable
internal data class ModelsCatalogDto(
    val providers: Map<String, ProviderConfigDto> = emptyMap(),
)

@Serializable
internal data class ProviderConfigDto(
    val api: String? = null,
    @SerialName("base_url")
    val baseUrl: String? = null,
    val models: List<RemoteModelDto> = emptyList(),
)

@Serializable
internal data class RemoteModelDto(
    val id: String,
    @SerialName("model_id")
    val modelId: String? = null,
    val name: String = "",
    val reasoning: Boolean = false,
    val input: List<String> = emptyList(),
    @SerialName("context_window")
    val contextWindow: Long? = null,
    @SerialName("max_tokens")
    val maxTokens: Long? = null,
    val multiplier: Double? = null,
    val tags: List<String> = emptyList(),
    @SerialName("reasoning_levels")
    val reasoningLevels: List<String> = emptyList(),
    @SerialName("default_reasoning_level")
    val defaultReasoningLevel: String? = null,
)

@Serializable
internal data class ChatCompletionRequestDto(
    val model: String,
    val messages: List<ChatMessageDto>,
    val stream: Boolean = true,
    val temperature: Double? = null,
)

@Serializable
internal data class ChatMessageDto(
    val role: String,
    val content: kotlinx.serialization.json.JsonElement,
)

@Serializable
internal data class OpenAiErrorBody(
    val error: OpenAiErrorDetail? = null,
    val message: String? = null,
)

@Serializable
internal data class OpenAiErrorDetail(
    val message: String? = null,
    val type: String? = null,
    val param: String? = null,
    val code: Int? = null,
)

@Serializable
internal data class TokenUsageDto(
    @SerialName("total_tokens")
    val totalTokens: Long = 0,
    @SerialName("input_tokens")
    val inputTokens: Long = 0,
    @SerialName("output_tokens")
    val outputTokens: Long = 0,
    val cost: Double = 0.0,
)

@Serializable
internal data class ChatUsageDto(
    val usage: TokenUsageDto? = null,
)
