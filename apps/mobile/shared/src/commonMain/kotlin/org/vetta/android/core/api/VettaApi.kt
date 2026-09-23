package org.vetta.android.core.api

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.preparePost
import io.ktor.client.request.delete
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.readRawBytes
import io.ktor.http.HttpHeaders
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.utils.io.readUTF8Line
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
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
 * - 认证与用户：`https://api.567.wiki/api/user/`
 * - 对话：`https://api.567.wiki/v1/chat/completions`
 */
internal class VettaApi(
    private val client: HttpClient,
    private val bareClient: HttpClient,
    private val config: VettaConfig,
    private val tokenStore: TokenStore,
) {
    suspend fun loginWithAccount(account: String, password: String): AuthSession {
        try {
            val response =
                client.post("api/user/login") {
                    setBody(NewApiLoginRequestDto(username = account, password = password))
                }
            val rawText = response.bodyAsTextSafe()
            if (!response.status.isSuccess()) {
                throw parseFailure(response.status.value, rawText)
            }

            var token: String? = null
            var userDto: UserDto? = null
            runCatching {
                val root = org.vetta.android.core.net.VettaJson.parseToJsonElement(rawText) as? kotlinx.serialization.json.JsonObject
                val data = root?.get("data") as? kotlinx.serialization.json.JsonObject
                token = (data?.get("access_token") as? kotlinx.serialization.json.JsonPrimitive)?.content
                    ?: (data?.get("token") as? kotlinx.serialization.json.JsonPrimitive)?.content
                if (data != null) {
                    val uid = (data["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() ?: 0L
                    val uname = (data["username"] as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()
                    val dname = (data["display_name"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                    val quota = (data["quota"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull() ?: 0L
                    userDto = UserDto(id = uid, username = uname, displayName = dname, quota = quota)
                }
            }

            if (token.isNullOrBlank()) {
                val rawCookies = response.headers.getAll(HttpHeaders.SetCookie) ?: emptyList()
                val cookieHeader = rawCookies.map { it.split(";")[0] }.joinToString("; ")
                if (cookieHeader.isNotBlank()) {
                    runCatching {
                        val refreshRes = client.post("api/user/auth/refresh") {
                            header(HttpHeaders.Cookie, cookieHeader)
                        }
                        val refText = refreshRes.bodyAsTextSafe()
                        val refRoot = org.vetta.android.core.net.VettaJson.parseToJsonElement(refText) as? kotlinx.serialization.json.JsonObject
                        val refData = refRoot?.get("data") as? kotlinx.serialization.json.JsonObject
                        token = (refData?.get("access_token") as? kotlinx.serialization.json.JsonPrimitive)?.content
                    }
                }
            }

            if (token.isNullOrBlank()) {
                throw VettaException.Api(
                    httpStatus = response.status.value,
                    code = null,
                    message = "登录成功但未能获取访问令牌，建议使用访问令牌 (Token) 直接登录",
                    rawBody = rawText,
                )
            }

            val effectiveUser = userDto ?: runCatching {
                client.get("api/user/self") {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }.parseEnvelope<UserDto>()
            }.getOrDefault(UserDto(username = account))

            val session = AuthSession(
                accessToken = token!!,
                refreshToken = token!!,
                user = effectiveUser.toDomain(),
            )
            tokenStore.save(token!!, token!!)
            return session
        } catch (e: Exception) {
            throw e.toVettaException()
        }
    }

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
            val token = tokenStore.accessToken
            val response =
                client.get("api/user/self") {
                    if (!token.isNullOrBlank()) {
                        header(HttpHeaders.Authorization, "Bearer $token")
                    }
                }
            response.parseEnvelope<UserDto>().toDomain()
        } catch (e: Exception) {
            throw e.toVettaException()
        }

    suspend fun subscriptionMe(): SubscriptionStatus =
        try {
            val user = me()
            val cents = (user.quota.toDouble() / 500000.0 * 100.0 + 0.5).toLong()
            val usdStr = "${cents / 100}.${(cents % 100).toString().padStart(2, '0')}"
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

    suspend fun getAvailableGroups(): Map<String, ApiGroupInfoDto> {
        return try {
            val token = tokenStore.accessToken
            val response = client.get("api/user/groups") {
                if (!token.isNullOrBlank()) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
            }
            val text = response.bodyAsTextSafe()
            val element = org.vetta.android.core.net.VettaJson.parseToJsonElement(text)
            val dataObj = (element as? kotlinx.serialization.json.JsonObject)?.get("data") as? kotlinx.serialization.json.JsonObject ?: return emptyMap()
            val result = mutableMapOf<String, ApiGroupInfoDto>()
            for ((key, value) in dataObj) {
                val groupObj = value as? kotlinx.serialization.json.JsonObject ?: continue
                val desc = (groupObj["desc"] as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()
                val ratioPrimitive = groupObj["ratio"] as? kotlinx.serialization.json.JsonPrimitive
                val ratio = ratioPrimitive?.content?.toDoubleOrNull() ?: 1.0
                result[key] = ApiGroupInfoDto(desc = desc, ratio = ratio)
            }
            result
        } catch (_: Exception) {
            emptyMap()
        }
    }

    companion object {
        val FALLBACK_CHAT_MODELS = listOf(
            "gpt-5.6-sol",
            "claude-3-7-sonnet-20250219",
            "deepseek-reasoner",
            "deepseek-chat",
            "gpt-4o",
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "qwen-plus",
        )
    }

    suspend fun fetchGroupModels(groupName: String?): List<String> {
        val patToken = tokenStore.accessToken

        // 1. 如果有登录 Token，先尝试调用 567 API 用户模型列表接口（有 group 则查指定分组，无 group 则查默认可用）
        if (!patToken.isNullOrBlank()) {
            try {
                val path = if (!groupName.isNullOrBlank()) {
                    val encoded = java.net.URLEncoder.encode(groupName, "UTF-8")
                    "api/user/models?group=$encoded"
                } else {
                    "api/user/models"
                }
                val res = client.get(path) {
                    header(HttpHeaders.Authorization, "Bearer $patToken")
                }
                val text = res.bodyAsTextSafe()
                if (res.status.isSuccess()) {
                    val root = org.vetta.android.core.net.VettaJson.parseToJsonElement(text)
                    val dataArr = (root as? kotlinx.serialization.json.JsonObject)?.get("data") as? kotlinx.serialization.json.JsonArray
                    if (dataArr != null && dataArr.isNotEmpty()) {
                        val ids = dataArr.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
                        if (ids.isNotEmpty()) return ids
                    }
                }
            } catch (_: Exception) {
            }
        }

        // 2. 如果 /api/user/models 没拿到，确保获取或创建专属 API Key (sk-...)，请求标准 /v1/models
        return try {
            val apiKey = ensureApiKeyForGroup(groupName)
            val keyToUse = if (apiKey.isNotBlank()) apiKey else patToken
            val res = bareClient.get(config.gatewayBaseUrl.trimEnd('/') + "/v1/models") {
                if (!keyToUse.isNullOrBlank()) {
                    header(HttpHeaders.Authorization, "Bearer $keyToUse")
                }
                if (!groupName.isNullOrBlank()) {
                    header("X-567-Group", java.net.URLEncoder.encode(groupName, "UTF-8"))
                }
            }
            val text = res.bodyAsTextSafe()
            val root = org.vetta.android.core.net.VettaJson.parseToJsonElement(text)
            val dataArr = (root as? kotlinx.serialization.json.JsonObject)?.get("data") as? kotlinx.serialization.json.JsonArray
            val ids = dataArr?.mapNotNull { el ->
                (el as? kotlinx.serialization.json.JsonObject)?.get("id")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
            } ?: emptyList()

            ids.ifEmpty { FALLBACK_CHAT_MODELS }
        } catch (_: Exception) {
            FALLBACK_CHAT_MODELS
        }
    }

    suspend fun goModels(activeGroup: String? = null): ModelsCatalog {
        var modelIds = fetchGroupModels(activeGroup)
        if (modelIds.isEmpty()) {
            modelIds = FALLBACK_CHAT_MODELS
        }
        val models = modelIds.map { id ->
            val isReasoning = id.contains("reasoner", ignoreCase = true) ||
                    id.contains("r1", ignoreCase = true) ||
                    id.contains("o1", ignoreCase = true) ||
                    id.contains("o3", ignoreCase = true) ||
                    id.contains("thinking", ignoreCase = true) ||
                    id.contains("sol", ignoreCase = true)
            LlmModel(
                id = id,
                modelId = id,
                name = id,
                providerName = activeGroup ?: "567 API",
                reasoning = isReasoning,
            )
        }
        val provider = ProviderModels(name = activeGroup ?: "567 API", models = models)
        return ModelsCatalog(providers = mapOf("vetta-go" to provider, "567api" to provider))
    }

    private val groupKeyCache = mutableMapOf<String, String>()
    private val autoCreatedTokens = mutableMapOf<String, Long>()

    private fun extractTokens(root: kotlinx.serialization.json.JsonElement?): List<kotlinx.serialization.json.JsonObject> {
        if (root == null) return emptyList()
        val obj = root as? kotlinx.serialization.json.JsonObject
        val data = obj?.get("data")
        if (data is kotlinx.serialization.json.JsonArray) {
            return data.mapNotNull { it as? kotlinx.serialization.json.JsonObject }
        }
        if (data is kotlinx.serialization.json.JsonObject) {
            val items = (data["items"] as? kotlinx.serialization.json.JsonArray)
                ?: (data["data"] as? kotlinx.serialization.json.JsonArray)
                ?: (data["tokens"] as? kotlinx.serialization.json.JsonArray)
            if (items != null) {
                return items.mapNotNull { it as? kotlinx.serialization.json.JsonObject }
            }
        }
        val directItems = (obj?.get("items") as? kotlinx.serialization.json.JsonArray)
            ?: (obj?.get("tokens") as? kotlinx.serialization.json.JsonArray)
        if (directItems != null) {
            return directItems.mapNotNull { it as? kotlinx.serialization.json.JsonObject }
        }
        return emptyList()
    }

    private suspend fun fetchUnmaskedKey(tokenId: Long, token: String): String? {
        try {
            val keyRes = client.post("api/token/$tokenId/key") {
                header(HttpHeaders.Authorization, "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody("{}")
            }
            val keyText = keyRes.bodyAsTextSafe()
            val keyRoot = org.vetta.android.core.net.VettaJson.parseToJsonElement(keyText)
            val rawData = (keyRoot as? kotlinx.serialization.json.JsonObject)?.get("data")
            val rawKey = when (rawData) {
                is kotlinx.serialization.json.JsonPrimitive -> rawData.content
                is kotlinx.serialization.json.JsonObject -> (rawData["key"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                else -> null
            }
            if (!rawKey.isNullOrBlank() && !rawKey.contains("*")) {
                return if (rawKey.startsWith("sk-")) rawKey else "sk-$rawKey"
            }
        } catch (_: Exception) {
        }
        return null
    }

    suspend fun cleanupGroupToken(groupName: String?) {
        val targetGroup = groupName?.takeIf { it.isNotBlank() } ?: return
        val token = tokenStore.accessToken ?: return
        groupKeyCache.remove(targetGroup)

        val recordedId = autoCreatedTokens.remove(targetGroup)
        if (recordedId != null) {
            try {
                client.delete("api/token/$recordedId") {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
            } catch (_: Exception) {
            }
            return
        }

        try {
            val res = client.get("api/token/?p=0&size=100") {
                header(HttpHeaders.Authorization, "Bearer $token")
            }
            val text = res.bodyAsTextSafe()
            val root = org.vetta.android.core.net.VettaJson.parseToJsonElement(text)
            val tokens = extractTokens(root)
            val autoToken = tokens.find {
                val grp = (it["group"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                val name = (it["name"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                grp == targetGroup && (name == "567 Agent [$targetGroup]" || name == "567 Auto [$targetGroup]")
            }
            val id = (autoToken?.get("id") as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull()
            if (id != null) {
                client.delete("api/token/$id") {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
            }
        } catch (_: Exception) {
        }
    }

    suspend fun ensureApiKeyForGroup(groupName: String?): String {
        val token = tokenStore.accessToken ?: return ""
        if (token.startsWith("sk-")) return token
        val cacheKey = groupName ?: "default"
        groupKeyCache[cacheKey]?.let { return it }

        try {
            val res = client.get("api/token/?p=0&size=100") {
                header(HttpHeaders.Authorization, "Bearer $token")
            }
            val text = res.bodyAsTextSafe()
            val root = org.vetta.android.core.net.VettaJson.parseToJsonElement(text)
            var tokens = extractTokens(root)

            val targetName = if (groupName != null) "567 Agent [$groupName]" else "567 Agent"

            // 1. 优先使用已有可用令牌，绝不重复创建
            var matched = if (!groupName.isNullOrBlank()) {
                tokens.find {
                    val grp = (it["group"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                    val name = (it["name"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                    val status = (it["status"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() ?: 1
                    status == 1 && (grp == groupName || name == targetName)
                } ?: tokens.find {
                    val grp = (it["group"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                    val status = (it["status"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() ?: 1
                    status == 1 && grp.isNullOrBlank()
                }
            } else {
                tokens.find {
                    val status = (it["status"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() ?: 1
                    status == 1
                }
            }

            if (matched != null) {
                val key = (matched["key"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                if (key != null && !key.contains("*") && key.length >= 20) {
                    val finalKey = if (key.startsWith("sk-")) key else "sk-$key"
                    groupKeyCache[cacheKey] = finalKey
                    return finalKey
                }
                val id = (matched["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull()
                if (id != null) {
                    val unmasked = fetchUnmaskedKey(id, token)
                    if (unmasked != null) {
                        groupKeyCache[cacheKey] = unmasked
                        return unmasked
                    }
                }
            }

            // 2. 只有在当前分组确实无可用令牌时，才自动创建并记录 Token ID
            client.post("api/token/") {
                header(HttpHeaders.Authorization, "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody(
                    buildJsonObject {
                        put("name", targetName)
                        if (groupName != null) put("group", groupName)
                        put("remain_quota", 0)
                        put("expired_time", -1)
                        put("unlimited_quota", true)
                    }.toString()
                )
            }

            val reloadRes = client.get("api/token/?p=0&size=100") {
                header(HttpHeaders.Authorization, "Bearer $token")
            }
            tokens = extractTokens(org.vetta.android.core.net.VettaJson.parseToJsonElement(reloadRes.bodyAsTextSafe()))
            val newlyCreated = tokens.find {
                val name = (it["name"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                val grp = (it["group"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                name == targetName || (groupName != null && grp == groupName)
            } ?: tokens.firstOrNull()

            if (newlyCreated != null) {
                val id = (newlyCreated["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content?.toLongOrNull()
                if (id != null && groupName != null) {
                    autoCreatedTokens[groupName] = id
                }
                if (id != null) {
                    val unmasked = fetchUnmaskedKey(id, token)
                    if (unmasked != null) {
                        groupKeyCache[cacheKey] = unmasked
                        return unmasked
                    }
                }
                val key = (newlyCreated["key"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                if (key != null && !key.contains("*") && key.length >= 20) {
                    val finalKey = if (key.startsWith("sk-")) key else "sk-$key"
                    groupKeyCache[cacheKey] = finalKey
                    return finalKey
                }
            }
        } catch (_: Exception) {
        }

        return token
    }

    private suspend fun ensureApiKeyForChat(groupName: String?): String =
        ensureApiKeyForGroup(groupName)

    suspend fun generateImage(
        prompt: String,
        model: String,
        groupName: String? = null,
        size: String = "1024x1024",
    ): GeneratedImageResult {
        val apiKey = ensureApiKeyForGroup(groupName)

        // 1. 优先尝试 /v1/images/generations 标准生图端点
        try {
            val url = config.gatewayBaseUrl.trimEnd('/') + "/v1/images/generations"
            val body = buildJsonObject {
                put("model", model)
                put("prompt", prompt)
                put("n", 1)
                put("size", size)
            }
            val secHeaders = org.vetta.android.core.net.SecurityHeaders.generate(
                deviceId = "mobile-${apiKey.hashCode().toUInt().toString(16)}",
                extraContext = if (!groupName.isNullOrBlank()) mapOf("X-567-Group" to java.net.URLEncoder.encode(groupName, "UTF-8")) else emptyMap()
            )

            val res = bareClient.post(url) {
                setBody(body.toString())
                contentType(ContentType.Application.Json)
                if (apiKey.isNotBlank()) {
                    header(HttpHeaders.Authorization, "Bearer $apiKey")
                }
                for ((k, v) in secHeaders) {
                    header(k, v)
                }
            }

            val text = res.bodyAsTextSafe()
            if (res.status.isSuccess()) {
                val extracted = extractImagePayload(text, prompt)
                if (!extracted.url.isNullOrBlank() || !extracted.b64Json.isNullOrBlank()) {
                    return extracted
                }
            }
        } catch (_: Exception) {
        }

        // 2. 转调 /v1/chat/completions 渠道
        val chatUrl = config.gatewayBaseUrl.trimEnd('/') + "/v1/chat/completions"
        val chatBody = buildJsonObject {
            put("model", model)
            put("messages", kotlinx.serialization.json.buildJsonArray {
                add(buildJsonObject {
                    put("role", "system")
                    put("content", "You are an AI image generator. Please generate and output the image directly or provide the image URL.")
                })
                add(buildJsonObject {
                    put("role", "user")
                    put("content", "Please generate an image for:\n$prompt")
                })
            })
            put("stream", false)
        }
        val secHeaders = org.vetta.android.core.net.SecurityHeaders.generate(
            deviceId = "mobile-${apiKey.hashCode().toUInt().toString(16)}",
            extraContext = if (!groupName.isNullOrBlank()) mapOf("X-567-Group" to java.net.URLEncoder.encode(groupName, "UTF-8")) else emptyMap()
        )

        val chatRes = bareClient.post(chatUrl) {
            setBody(chatBody.toString())
            contentType(ContentType.Application.Json)
            if (apiKey.isNotBlank()) {
                header(HttpHeaders.Authorization, "Bearer $apiKey")
            }
            for ((k, v) in secHeaders) {
                header(k, v)
            }
        }

        val chatText = chatRes.bodyAsTextSafe()
        if (!chatRes.status.isSuccess()) {
            throw parseFailure(chatRes.status.value, chatText)
        }

        return extractImagePayload(chatText, prompt)
    }

    private fun extractImagePayload(jsonText: String, prompt: String): GeneratedImageResult {
        var foundUrl: String? = null
        var foundB64: String? = null
        var rawText: String? = null

        try {
            val root = org.vetta.android.core.net.VettaJson.parseToJsonElement(jsonText)

            fun scan(el: kotlinx.serialization.json.JsonElement) {
                if (foundUrl != null || foundB64 != null) return
                when (el) {
                    is kotlinx.serialization.json.JsonObject -> {
                        val directB64 = (el["b64_json"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                            ?: (el["b64"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                            ?: (el["image_base64"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                        if (!directB64.isNullOrBlank() && directB64.length > 50 && directB64 != "null") {
                            foundB64 = directB64
                            return
                        }

                        val inlineData = el["inlineData"] as? kotlinx.serialization.json.JsonObject
                        val inlineB64 = (inlineData?.get("data") as? kotlinx.serialization.json.JsonPrimitive)?.content
                        if (!inlineB64.isNullOrBlank() && inlineB64.length > 50 && inlineB64 != "null") {
                            foundB64 = inlineB64
                            return
                        }

                        val directUrl = (el["url"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                        if (!directUrl.isNullOrBlank() && directUrl.startsWith("http") && directUrl != "null") {
                            foundUrl = directUrl
                            return
                        }

                        val imgUrl = el["image_url"]
                        if (imgUrl is kotlinx.serialization.json.JsonPrimitive && imgUrl.content.startsWith("http")) {
                            foundUrl = imgUrl.content
                            return
                        } else if (imgUrl is kotlinx.serialization.json.JsonObject) {
                            val u = (imgUrl["url"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                            if (!u.isNullOrBlank() && u.startsWith("http")) {
                                foundUrl = u
                                return
                            }
                        }

                        for ((k, v) in el) {
                            if (foundUrl != null || foundB64 != null) return
                            if (k == "content" && v is kotlinx.serialization.json.JsonPrimitive) {
                                val c = v.content
                                if (c.isNotBlank() && c != "null") {
                                    rawText = c
                                }
                            } else {
                                scan(v)
                            }
                        }
                    }
                    is kotlinx.serialization.json.JsonArray -> {
                        for (item in el) {
                            if (foundUrl != null || foundB64 != null) return
                            scan(item)
                        }
                    }
                    is kotlinx.serialization.json.JsonPrimitive -> {
                        val s = el.content
                        if (s.startsWith("data:image/") && s.contains("base64,")) {
                            foundB64 = s.substringAfter("base64,")
                        } else if (s.startsWith("http://") || s.startsWith("https://")) {
                            foundUrl = s
                        }
                    }
                }
            }

            scan(root)

            if (foundUrl == null && foundB64 == null && rawText != null) {
                val b64Match = Regex("data:image/[^;]+;base64,([A-Za-z0-9+/=]+)").find(rawText!!)
                if (b64Match != null) {
                    foundB64 = b64Match.groupValues[1]
                } else {
                    val mdMatch = Regex("""!\[.*?\]\((https?://[^ \n\r\t)]+)\)""").find(rawText!!)
                    if (mdMatch != null) {
                        foundUrl = mdMatch.groupValues[1]
                    } else {
                        val urlMatch = Regex("""(https?://[^ \n\r\t)<>"']+)""").find(rawText!!)
                        if (urlMatch != null) {
                            foundUrl = urlMatch.groupValues[1]
                        }
                    }
                }
            }
        } catch (_: Exception) {
        }

        val cleanText = if (rawText == "null" || rawText.isNullOrBlank()) null else rawText
        return GeneratedImageResult(url = foundUrl, b64Json = foundB64, prompt = prompt, textContent = cleanText)
    }

    suspend fun downloadBytes(url: String): ByteArray {
        return client.get(url).readRawBytes()
    }

    suspend fun fetchGroupImageModels(groupName: String?): List<String> {
        val allModels = fetchGroupModels(groupName)
        if (allModels.isEmpty()) return emptyList()

        // 优先将生图相关的模型排在前面
        val imageKeywords = listOf("flux", "dall-e", "midjourney", "sd", "stable-diffusion", "imagen", "recraft", "image")
        val imageModels = allModels.filter { model ->
            val lower = model.lowercase()
            imageKeywords.any { lower.contains(it) }
        }
        return if (imageModels.isNotEmpty()) imageModels else allModels
    }

    fun streamChat(
        model: String,
        messages: List<ChatMessage>,
        temperature: Double? = null,
        groupName: String? = null,
        imageGenModel: String? = null,
    ): Flow<ChatStreamEvent> =
        flow {
            val wireMessages = ChatRequestEncoder.encodeMessages(messages)
            val bodyJson = buildJsonObject {
                put("model", model)
                put("messages", kotlinx.serialization.json.JsonArray(wireMessages))
                put("stream", true)
                if (temperature != null) {
                    put("temperature", temperature)
                }
                if (!imageGenModel.isNullOrBlank()) {
                    put("tools", kotlinx.serialization.json.buildJsonArray {
                        add(buildJsonObject {
                            put("type", "function")
                            put("function", buildJsonObject {
                                put("name", "generate_image")
                                put("description", "当用户明确要求画图、绘制图片、生成插画或视觉展示时调用该工具。")
                                put("parameters", buildJsonObject {
                                    put("type", "object")
                                    put("properties", buildJsonObject {
                                        put("prompt", buildJsonObject {
                                            put("type", "string")
                                            put("description", "画面描述词，包含主体细节、风格、色彩光影与构图。")
                                        })
                                    })
                                    put("required", kotlinx.serialization.json.buildJsonArray {
                                        add(kotlinx.serialization.json.JsonPrimitive("prompt"))
                                    })
                                })
                            })
                        })
                    })
                    put("tool_choice", "auto")
                }
            }
            val url = config.gatewayBaseUrl.trimEnd('/') + "/v1/chat/completions"
            val token = ensureApiKeyForChat(groupName)
            val secHeaders = org.vetta.android.core.net.SecurityHeaders.generate(
                deviceId = "mobile-${token.hashCode().toUInt().toString(16)}",
                extraContext = if (!groupName.isNullOrBlank()) mapOf("X-567-Group" to java.net.URLEncoder.encode(groupName, "UTF-8")) else emptyMap()
            )
            try {
                bareClient.preparePost(url) {
                    setBody(bodyJson.toString())
                    contentType(ContentType.Application.Json)
                    if (!token.isNullOrBlank()) {
                        header(HttpHeaders.Authorization, "Bearer $token")
                    }
                    for ((k, v) in secHeaders) {
                        header(k, v)
                    }
                    header(HttpHeaders.Accept, "text/event-stream")
                }.execute { response ->
                    if (!response.status.isSuccess()) {
                        val text = response.bodyAsTextSafe()
                        emit(ChatStreamEvent.Error(parseFailure(response.status.value, text)))
                        return@execute
                    }

                    val channel = response.bodyAsChannel()
                    var sawDone = false
                    var sawAnyEvent = false
                    val bufferedLines = mutableListOf<String>()

                    while (!channel.isClosedForRead) {
                        val line = channel.readUTF8Line() ?: break
                        val trimmed = line.trim()
                        if (trimmed.isEmpty() || trimmed.startsWith(":")) continue
                        bufferedLines.add(line)

                        val event = OpenAiSseParser.parseLine(line)
                        if (event != null) {
                            sawAnyEvent = true
                            if (event is ChatStreamEvent.Done) {
                                sawDone = true
                            }
                            emit(event)
                            if (event is ChatStreamEvent.Error) {
                                return@execute
                            }
                        }
                    }

                    // 兜底保障：如果循环读完没有产生任何有效 SSE 事件（例如返回了非流式 JSON）
                    if (!sawAnyEvent && bufferedLines.isNotEmpty()) {
                        val fullText = bufferedLines.joinToString("\n")
                        val fallbackEvents = OpenAiSseParser.parseNonStreamJson(fullText)
                        if (fallbackEvents.isNotEmpty()) {
                            for (ev in fallbackEvents) {
                                emit(ev)
                                if (ev is ChatStreamEvent.Done) {
                                    sawDone = true
                                }
                            }
                        }
                    }

                    if (!sawDone) {
                        emit(ChatStreamEvent.Done)
                    }
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
