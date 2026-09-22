package org.vetta.android.core.api

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.utils.io.readUTF8Line
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.vetta.android.core.VettaConfig
import org.vetta.android.core.auth.TokenStore
import org.vetta.android.core.chat.ChatRequestEncoder
import org.vetta.android.core.chat.OpenAiSseParser
import org.vetta.android.core.error.VettaException
import org.vetta.android.core.model.AuthSession
import org.vetta.android.core.model.ChatMessage
import org.vetta.android.core.model.ChatStreamEvent
import org.vetta.android.core.model.LlmModel
import org.vetta.android.core.model.ModelsCatalog
import org.vetta.android.core.model.ProviderModels
import org.vetta.android.core.model.SubscriptionStatus
import org.vetta.android.core.model.User
import org.vetta.android.core.net.RefreshOutcome
import org.vetta.android.core.net.VettaJson
import org.vetta.android.core.net.parseEnvelope
import org.vetta.android.core.net.parseFailure
import org.vetta.android.core.net.toVettaException

/**
 * 对 567 API / Gateway 的薄封装。
 * - 认证与用户：`https://api.567.wiki/api/user/*`
 * - 对话：`https://api.567.wiki/v1/chat/completions`
 */
internal class VettaApi(
    private val client: HttpClient,
    private val bareClient: HttpClient,
    private val config: VettaConfig,
    private val tokenStore: TokenStore,
) {
    suspend fun loginWithAccount(account: String, password: String): AuthSession =
        postAuth("api/user/login", NewApiLoginRequestDto(username = account, password = password))

    suspend fun loginWithAccessToken(token: String): AuthSession {
        try {
            val response =
                client.get("api/user/self") {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
            val text = response.bodyAsTextSafe()
            if (!response.status.isSuccess()) {
                throw parseFailure(response.status.value, text)
            }
            val userDto = response.parseEnvelope<UserDto>()
            val session = AuthSession(
                accessToken = token,
                refreshToken = token,
                user = userDto.toDomain(),
            )
            tokenStore.save(token, token)
            return session
        } catch (e: Exception) {
            throw e.toVettaException()
        }
    }

    suspend fun loginWithEmailPassword(email: String, password: String): AuthSession =
        loginWithAccount(email, password)

    suspend fun loginWithSms(phone: String, code: String): AuthSession =
        loginWithAccount(phone, code)

    suspend fun sendSmsCode(phone: String) {
        // 567 API 暂不提供短信验证码
    }

    suspend fun refreshTokens(refreshToken: String): RefreshOutcome {
        return if (refreshToken.isNotBlank()) {
            RefreshOutcome.Ok(refreshToken, refreshToken)
        } else {
            RefreshOutcome.Unauthorized
        }
    }

    suspend fun logout() {
        tokenStore.clear()
    }

    suspend fun me(): User =
        try {
            client.get("api/user/self").parseEnvelope<UserDto>().toDomain()
        } catch (e: Exception) {
            throw e.toVettaException()
        }

    suspend fun subscriptionMe(): SubscriptionStatus =
        try {
            val user = me()
            val usdStr = (user.quota.toDouble() / 500000.0).toString()
            SubscriptionStatus(
                active = true,
                isDefault = true,
                goEnabled = true,
                tierName = "567 API",
                badgeText = "567",
                description = "额度: $$usdStr",
            )
        } catch (_: Exception) {
            SubscriptionStatus(active = true, isDefault = true, tierName = "567 API", badgeText = "567")
        }

    suspend fun goModels(): ModelsCatalog =
        try {
            default567ModelsCatalog()
        } catch (e: Exception) {
            throw e.toVettaException()
        }

    fun streamChat(
        model: String,
        messages: List<ChatMessage>,
        temperature: Double? = null,
    ): Flow<ChatStreamEvent> =
        flow {
            val wireMessages = ChatRequestEncoder.encodeMessages(messages)
            val body =
                ChatCompletionRequestDto(
                    model = model,
                    messages =
                        wireMessages.map { obj ->
                            ChatMessageDto(
                                role = (obj["role"] as kotlinx.serialization.json.JsonPrimitive).content,
                                content = obj["content"]!!,
                            )
                        },
                    stream = true,
                    temperature = temperature,
                )
            val url = config.gatewayBaseUrl.trimEnd('/') + "/v1/chat/completions"
            try {
                val response =
                    client.post(url) {
                        setBody(body)
                        headers.append(HttpHeaders.Accept, "text/event-stream")
                    }
                if (!response.status.isSuccess()) {
                    val text = response.bodyAsTextSafe()
                    emit(ChatStreamEvent.Error(parseFailure(response.status.value, text)))
                    return@flow
                }

                val channel = response.bodyAsChannel()
                var sawDone = false
                while (!channel.isClosedForRead) {
                    val line = channel.readUTF8Line() ?: break
                    val event = OpenAiSseParser.parseLine(line) ?: continue
                    if (event is ChatStreamEvent.Done) {
                        sawDone = true
                    }
                    emit(event)
                    if (event is ChatStreamEvent.Error) {
                        return@flow
                    }
                }
                if (!sawDone) {
                    emit(ChatStreamEvent.Done)
                }
            } catch (e: Exception) {
                emit(ChatStreamEvent.Error(e.toVettaException()))
            }
        }

    private suspend fun postAuth(path: String, body: Any): AuthSession =
        try {
            val response =
                client.post(path) {
                    setBody(body)
                }
            val session = response.parseEnvelope<LoginResponseDto>().toSession()
            tokenStore.save(session.accessToken, session.refreshToken)
            session
        } catch (e: Exception) {
            throw e.toVettaException()
        }
}

private fun default567ModelsCatalog(): ModelsCatalog {
    val models = listOf(
        LlmModel(id = "gpt-5.6-sol", modelId = "gpt-5.6-sol", name = "GPT-5.6 Sol (567特价)", providerName = "567 API", reasoning = true),
        LlmModel(id = "gpt-4o", modelId = "gpt-4o", name = "GPT-4o 旗舰", providerName = "567 API"),
        LlmModel(id = "deepseek-chat", modelId = "deepseek-chat", name = "DeepSeek-V3", providerName = "567 API"),
        LlmModel(id = "deepseek-reasoner", modelId = "deepseek-reasoner", name = "DeepSeek-R1 (深度思考)", providerName = "567 API", reasoning = true),
        LlmModel(id = "claude-3-7-sonnet", modelId = "claude-3-7-sonnet", name = "Claude 3.7 Sonnet", providerName = "567 API", reasoning = true),
        LlmModel(id = "gemini-2.5-pro", modelId = "gemini-2.5-pro", name = "Gemini 2.5 Pro", providerName = "567 API"),
    )
    val provider = ProviderModels(name = "567 API", models = models)
    return ModelsCatalog(providers = mapOf("567api" to provider, "vetta-go" to provider))
}

private suspend fun HttpResponse.bodyAsTextSafe(): String =
    runCatching { bodyAsText() }.getOrDefault("")
