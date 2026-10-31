package org.agent567.android.core.api

import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.agent567.android.AppVersion




import io.ktor.client.HttpClient
import io.ktor.client.plugins.timeout
import io.ktor.client.request.get
import io.ktor.client.request.request
import io.ktor.client.request.header
import io.ktor.client.request.put
import io.ktor.client.request.post
import io.ktor.client.request.preparePost
import io.ktor.client.request.delete
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.client.statement.readRawBytes
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.ContentType
import io.ktor.http.Url
import io.ktor.http.URLBuilder
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.utils.io.readUTF8Line
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.serviceIdentity
import org.agent567.android.core.auth.TokenStore
import org.agent567.android.core.chat.ChatRequestEncoder
import org.agent567.android.core.chat.OpenAiSseParser
import org.agent567.android.core.chat.OpenAiSseStreamParser
import org.agent567.android.core.error.Agent567Exception
import org.agent567.android.core.model.AuthSession
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.core.model.LlmModel
import org.agent567.android.core.model.CachedModelContext
import org.agent567.android.core.model.MODEL_CONTEXT_CACHE_TTL_MS
import org.agent567.android.core.model.parseModelContextMetadata
import org.agent567.android.core.model.resolveModelContext
import org.agent567.android.core.model.ModelsCatalog
import org.agent567.android.core.model.ProviderModels
import org.agent567.android.core.model.SubscriptionStatus
import org.agent567.android.core.model.User
import org.agent567.android.core.net.TokenRefresher
import org.agent567.android.core.net.isRefreshCredentialRejected
import org.agent567.android.core.net.isAccountLoginRejected
import org.agent567.android.core.net.RefreshOutcome
import org.agent567.android.core.net.Agent567Json
import org.agent567.android.core.net.parseEnvelope
import org.agent567.android.core.net.parseFailure
import org.agent567.android.core.net.toAgent567Exception
import org.agent567.android.app.normalizeGitHubDownloadPrefix

private const val IMAGE_GENERATION_TIMEOUT_MS = 600_000L
private const val MAX_NON_STREAM_FALLBACK_CHARS = 1_000_000
private const val MAX_SSE_LINE_CHARS = 1_000_000

/**
 * 对 567 API / Gateway 的薄封装。
 * - 认证与用户：`https://api.567.wiki/api/user/`
 * - 对话：`https://api.567.wiki/v1/chat/completions`
 */
data class AppUpdateCheckResult(
    val hasUpdate: Boolean,
    val latestVersion: String,
    val currentVersion: String,
    val releaseNotes: String,
    val apkUrl: String?,
    val error: String? = null,
    val apkName: String? = null,
    val apkSize: Long? = null,
    val apkSha256: String? = null,
)

private fun isNewerVersion(remote: String, local: String): Boolean {
    val rParts = remote.removePrefix("v").split(".").mapNotNull { it.toIntOrNull() }
    val lParts = local.removePrefix("v").split(".").mapNotNull { it.toIntOrNull() }
    for (i in 0 until maxOf(rParts.size, lParts.size)) {
        val r = rParts.getOrElse(i) { 0 }
        val l = lParts.getOrElse(i) { 0 }
        if (r > l) return true
        if (r < l) return false
    }
    return false
}

internal class Agent567Api(
    private val client: HttpClient,
    private val bareClient: HttpClient,
    private val config: Agent567Config,
    private val tokenStore: TokenStore,
    private val tokenRefresher: TokenRefresher,
    private val preferences: org.agent567.android.app.AppPreferences? = null,
) {
    suspend fun loginWithAccount(account: String, password: String): AuthSession {
        val session = requestAccountSession(account, password)
        tokenRefresher.installSession(session.accessToken, session.refreshToken)
        return session
    }

    private suspend fun requestAccountSession(account: String, password: String): AuthSession {
        try {
            val keyResponse = bareClient.get("${config.apiBaseUrl.trimEnd('/')}/api/user/login/encryption-key") {
                timeout { requestTimeoutMillis = 8_000 }
            }
            val keyText = keyResponse.bodyAsTextSafe()
            if (keyText.length > 32_768) throw Agent567Exception.Protocol("登录加密配置超过安全长度限制")
            val keyData = runCatching { Agent567Json.parseToJsonElement(keyText) as? JsonObject }.getOrNull()
            val loginBody = org.agent567.android.core.auth.passwordLoginEnvelope(account, password, keyResponse.status.value, keyData)
            val response =
                bareClient.post("${config.apiBaseUrl.trimEnd('/')}/api/user/login") {
                    setBody(loginBody)
                }
            val rawText = response.bodyAsTextSafe()
            if (!response.status.isSuccess()) {
                throw parseFailure(response.status.value, rawText)
            }

            val loginRoot = Agent567Json.parseToJsonElement(rawText) as? JsonObject
            if ((loginRoot?.get("success") as? JsonPrimitive)?.content == "false") {
                throw parseFailure(response.status.value, rawText)
            }
            var token: String? = null
            var userDto: UserDto? = null
            runCatching {
                val root = org.agent567.android.core.net.Agent567Json.parseToJsonElement(rawText) as? kotlinx.serialization.json.JsonObject
                val data = root?.get("data") as? kotlinx.serialization.json.JsonObject
                token = (data?.get("access_token") as? kotlinx.serialization.json.JsonPrimitive)?.content
                    ?: (data?.get("token") as? kotlinx.serialization.json.JsonPrimitive)?.content
                if (data != null) {
                    val profile = data["user"] as? JsonObject ?: data
                    userDto = Agent567Json.decodeFromJsonElement<UserDto>(profile).takeIf { it.id > 0 && it.username.isNotBlank() }
                }
            }

            if (token.isNullOrBlank()) {
                val rawCookies = response.headers.getAll(HttpHeaders.SetCookie) ?: emptyList()
                val cookieHeader = rawCookies.map { it.split(";")[0] }.joinToString("; ")
                if (cookieHeader.isNotBlank()) {
                    runCatching {
                        val refreshRes = bareClient.post("${config.apiBaseUrl.trimEnd('/')}/api/user/auth/refresh") {
                            header(HttpHeaders.Cookie, cookieHeader)
                            header(HttpHeaders.Origin, cookieRequestOrigin())
                        }
                        val refText = refreshRes.bodyAsTextSafe()
                        val refRoot = org.agent567.android.core.net.Agent567Json.parseToJsonElement(refText) as? kotlinx.serialization.json.JsonObject
                        val refData = refRoot?.get("data") as? kotlinx.serialization.json.JsonObject
                        token = (refData?.get("access_token") as? kotlinx.serialization.json.JsonPrimitive)?.content
                    }
                }
            }

            if (token.isNullOrBlank()) {
                throw Agent567Exception.Api(
                    httpStatus = response.status.value,
                    code = null,
                    message = "登录成功但未能获取访问令牌，建议使用访问令牌 (Token) 直接登录",
                    rawBody = rawText,
                )
            }

            val rawCookies = response.headers.getAll(HttpHeaders.SetCookie) ?: emptyList()
            val cookieHeader = rawCookies.map { it.split(";")[0] }.joinToString("; ").takeIf { it.isNotBlank() }
            val effectiveRefreshToken = cookieHeader ?: token!!

            val effectiveUser = userDto ?: runCatching {
                bareClient.get("${config.apiBaseUrl.trimEnd('/')}/api/user/self") {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }.parseEnvelope<UserDto>()
            }.getOrDefault(UserDto(username = account))

            val session = AuthSession(
                accessToken = token!!,
                refreshToken = effectiveRefreshToken,
                user = effectiveUser.toDomain(),
            )
            return session
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            throw e.toAgent567Exception()
        }
    }

    suspend fun loginWithAccessToken(token: String): AuthSession {
        try {
            val response =
                bareClient.get("${config.apiBaseUrl.trimEnd('/')}/api/user/self") {
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
            tokenRefresher.installSession(token, token)
            return session
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            throw e.toAgent567Exception()
        }
    }

    suspend fun loginWithEmailPassword(email: String, password: String): AuthSession =
        loginWithAccount(email, password)

    suspend fun loginWithSms(phone: String, code: String): AuthSession =
        loginWithAccount(phone, code)

    suspend fun sendSmsCode(phone: String) {
        // 567 API 暂不提供短信验证码
    }

    private fun cookieRequestOrigin(): String = URLBuilder(config.apiBaseUrl).apply {
        encodedPathSegments = emptyList()
        parameters.clear()
        trailingQuery = false
        fragment = ""
        user = null
        password = null
    }.buildString().trimEnd('/')

    suspend fun refreshTokens(refreshToken: String): RefreshOutcome {
        if (refreshToken.isBlank()) return RefreshOutcome.Unauthorized

        if (refreshToken.contains("=") || refreshToken.contains("session", ignoreCase = true)) {
            try {
                val refreshRes = bareClient.post("${config.apiBaseUrl.trimEnd('/')}/api/user/auth/refresh") {
                    header(HttpHeaders.Cookie, refreshToken)
                    header(HttpHeaders.Origin, cookieRequestOrigin())
                }
                val text = refreshRes.bodyAsText()
                if (isRefreshCredentialRejected(refreshRes.status.value, text)) return RefreshOutcome.Unauthorized
                if (!refreshRes.status.isSuccess()) {
                    return RefreshOutcome.Transient
                }

                val rawCookies = refreshRes.headers.getAll(HttpHeaders.SetCookie) ?: emptyList()
                val newCookieHeader = if (rawCookies.isNotEmpty()) {
                    rawCookies.map { it.split(";")[0] }.joinToString("; ")
                } else {
                    refreshToken
                }

                val root = org.agent567.android.core.net.Agent567Json.parseToJsonElement(text) as? kotlinx.serialization.json.JsonObject
                val data = root?.get("data") as? kotlinx.serialization.json.JsonObject
                val newAccessToken = (data?.get("access_token") as? kotlinx.serialization.json.JsonPrimitive)?.content

                if (!newAccessToken.isNullOrBlank()) {
                    return RefreshOutcome.Ok(newAccessToken, newCookieHeader)
                }
                return RefreshOutcome.Transient
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                return RefreshOutcome.Transient
            }
        }

        return RefreshOutcome.Unauthorized
    }

    suspend fun refreshTokensWithAccountRecovery(refreshToken: String): RefreshOutcome {
        when (val outcome = refreshTokens(refreshToken)) {
            is RefreshOutcome.Ok, RefreshOutcome.Transient, RefreshOutcome.AccountRejected -> return outcome
            RefreshOutcome.Unauthorized -> Unit
        }

        val savedPreferences = preferences ?: return RefreshOutcome.Unauthorized
        if (savedPreferences.authLoginType != "account") return RefreshOutcome.Unauthorized
        val account = savedPreferences.authAccount?.takeIf { it.isNotBlank() } ?: return RefreshOutcome.Unauthorized
        val password = savedPreferences.authPassword?.takeIf { it.isNotBlank() } ?: return RefreshOutcome.Unauthorized

        return try {
            val session = requestAccountSession(account, password)
            RefreshOutcome.Ok(session.accessToken, session.refreshToken, session.user)
        } catch (error: kotlinx.coroutines.CancellationException) {
            throw error
        } catch (error: Agent567Exception.Unauthorized) {
            RefreshOutcome.AccountRejected
        } catch (error: Agent567Exception.Api) {
            if (isAccountLoginRejected(error.httpStatus, error.message)) RefreshOutcome.AccountRejected
            else RefreshOutcome.Transient
        } catch (_: Exception) {
            RefreshOutcome.Transient
        }
    }

    private suspend fun executeWithAuthRefresh(
        expectedSessionVersion: Long = tokenRefresher.sessionVersion,
        action: suspend (token: String) -> HttpResponse,
    ): HttpResponse {
        val version = expectedSessionVersion
        if (version != tokenRefresher.sessionVersion) throw Agent567Exception.Unauthorized()
        var token = tokenStore.accessToken.orEmpty()
        var response = action(token)
        if (version != tokenRefresher.sessionVersion) throw Agent567Exception.Unauthorized()
        if (isRefreshCredentialRejected(response.status.value, response.bodyAsTextSafe()) && !tokenStore.refreshToken.isNullOrBlank()) {
            val outcome = tokenRefresher.refresh(token)
            if (version != tokenRefresher.sessionVersion) throw Agent567Exception.Unauthorized()
            when (outcome) {
                is RefreshOutcome.Ok -> {
                    token = outcome.accessToken
                    response = action(token)
                }
                RefreshOutcome.Transient -> throw Agent567Exception.Network("暂时无法恢复登录，请检查网络后重试")
                RefreshOutcome.AccountRejected, RefreshOutcome.Unauthorized -> throw Agent567Exception.Unauthorized("登录资料暂时无法恢复，请重新验证登录")
            }
        }
        if (version != tokenRefresher.sessionVersion) throw Agent567Exception.Unauthorized()
        return response
    }

    suspend fun logout() {
        tokenRefresher.clearSession()
    }

    suspend fun sendVerificationCode(email: String): String {
        val cleanEmail = email.trim()
        val url = "${config.apiBaseUrl.trimEnd('/')}/api/verification?email=${java.net.URLEncoder.encode(cleanEmail, "UTF-8")}"
        val response = bareClient.get(url)
        val text = response.bodyAsTextSafe()
        val root = org.agent567.android.core.net.Agent567Json.parseToJsonElement(text)
        val success = (root as? kotlinx.serialization.json.JsonObject)?.get("success")?.let {
            (it as? kotlinx.serialization.json.JsonPrimitive)?.content?.toBooleanStrictOrNull()
        } ?: false
        val message = (root as? kotlinx.serialization.json.JsonObject)?.get("message")?.let {
            (it as? kotlinx.serialization.json.JsonPrimitive)?.content
        }
        if (!success) {
            throw Agent567Exception.Api(response.status.value, response.status.value, message ?: "发送验证码失败，请检查邮箱有效性")
        }
        return message ?: "验证码已发送至您的邮箱"
    }

    suspend fun register(
        username: String,
        password: String,
        email: String,
        code: String,
        affCode: String?,
    ): AuthSession {
        val url = "${config.apiBaseUrl.trimEnd('/')}/api/user/register"
        val payload = buildJsonObject {
            put("username", username.trim())
            put("password", password.trim())
            put("email", email.trim())
            put("verification_code", code.trim())
            if (!affCode.isNullOrBlank()) {
                put("aff_code", affCode.trim())
            }
        }
        val response = bareClient.post(url) {
            contentType(ContentType.Application.Json)
            setBody(payload.toString())
        }
        val text = response.bodyAsTextSafe()
        val root = org.agent567.android.core.net.Agent567Json.parseToJsonElement(text)
        val success = (root as? kotlinx.serialization.json.JsonObject)?.get("success")?.let {
            (it as? kotlinx.serialization.json.JsonPrimitive)?.content?.toBooleanStrictOrNull()
        } ?: false
        val message = (root as? kotlinx.serialization.json.JsonObject)?.get("message")?.let {
            (it as? kotlinx.serialization.json.JsonPrimitive)?.content
        }
        if (!success) {
            throw Agent567Exception.Api(response.status.value, response.status.value, message ?: "注册失败")
        }
        return loginWithAccount(username.trim(), password.trim())
    }

    suspend fun topupWithKey(key: String): String {
        val cleanKey = key.trim()
        val url = "${config.apiBaseUrl.trimEnd('/')}/api/user/topup"
        val response = executeWithAuthRefresh { token ->
            bareClient.post(url) {
                if (token.isNotBlank()) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                contentType(ContentType.Application.Json)
                val body = buildJsonObject {
                    put("key", cleanKey)
                }
                setBody(body.toString())
            }
        }
        val text = response.bodyAsTextSafe()
        val root = org.agent567.android.core.net.Agent567Json.parseToJsonElement(text)
        val success = (root as? kotlinx.serialization.json.JsonObject)?.get("success")?.let {
            (it as? kotlinx.serialization.json.JsonPrimitive)?.content?.toBooleanStrictOrNull()
        } ?: false
        val message = (root as? kotlinx.serialization.json.JsonObject)?.get("message")?.let {
            (it as? kotlinx.serialization.json.JsonPrimitive)?.content
        }
        if (!success) {
            throw Agent567Exception.Api(response.status.value, response.status.value, message ?: "兑换失败，请检查卡密有效性")
        }
        return message ?: "兑换成功！额度已到账"
    }

    suspend fun createPayOrder(amount: Int, paymentMethod: String): org.agent567.android.core.PayOrderResult {
        val url = "${config.apiBaseUrl.trimEnd('/')}/api/user/pay"
        val response = executeWithAuthRefresh { token ->
            bareClient.post(url) {
                if (token.isNotBlank()) {
                    header(HttpHeaders.Authorization, "Bearer $token")
                }
                contentType(ContentType.Application.Json)
                val body = buildJsonObject {
                    put("amount", amount)
                    put("payment_method", paymentMethod)
                }
                setBody(body.toString())
            }
        }
        val text = response.bodyAsTextSafe()
        val root = org.agent567.android.core.net.Agent567Json.parseToJsonElement(text)
        val obj = root as? kotlinx.serialization.json.JsonObject
        val submitUrl = (obj?.get("url") as? kotlinx.serialization.json.JsonPrimitive)?.content
        val dataObj = obj?.get("data") as? kotlinx.serialization.json.JsonObject
        if (submitUrl.isNullOrBlank() || dataObj == null) {
            val message = (obj?.get("message") as? kotlinx.serialization.json.JsonPrimitive)?.content
            throw Agent567Exception.Api(response.status.value, response.status.value, if (isPaymentUnavailable(message.orEmpty())) "在线支付暂未开放" else message ?: "创建支付订单失败")
        }
        val query = dataObj.entries.joinToString("&") { (k, v) ->
            val vStr = (v as? kotlinx.serialization.json.JsonPrimitive)?.content ?: v.toString()
            "${k}=${java.net.URLEncoder.encode(vStr, "UTF-8")}"
        }
        val payUrl = "$submitUrl?$query"

        var codeUrl: String? = null
        var urlScheme: String? = null
        runCatching {
            val page1Res = bareClient.get(payUrl)
            val page1Text = page1Res.bodyAsTextSafe()
            val repMatch = Regex("""window\.location\.replace\(['"]([^'"]+)['"]\)""").find(page1Text)?.groupValues?.getOrNull(1)
            var targetHtml = page1Text
            if (repMatch != null) {
                val nextUrl = if (repMatch.startsWith("http")) repMatch else {
                    val base = payUrl.substringBefore("?").substringBeforeLast("/")
                    "${base.trimEnd('/')}/${repMatch.trimStart('/')}"
                }
                val page2Res = bareClient.get(nextUrl)
                targetHtml = page2Res.bodyAsTextSafe()
            }
            val match = Regex("""(?:var|let|const)?\s*code_url\s*=\s*['"]([^'"]+)['"]""").find(targetHtml)?.groupValues?.getOrNull(1)
            if (!match.isNullOrBlank()) {
                codeUrl = match.trim()
                if (paymentMethod == "alipay") {
                    urlScheme = "alipays://platformapi/startapp?appId=20000067&url=" + java.net.URLEncoder.encode(codeUrl, "UTF-8")
                } else if (paymentMethod == "wxpay") {
                    urlScheme = codeUrl
                }
            }
        }

        return org.agent567.android.core.PayOrderResult(payUrl = payUrl, codeUrl = codeUrl, urlScheme = urlScheme)
    }

    suspend fun me(): User =
        try {
            val response = executeWithAuthRefresh { token ->
                bareClient.get("${config.apiBaseUrl.trimEnd('/')}/api/user/self") {
                    if (token.isNotBlank()) {
                        header(HttpHeaders.Authorization, "Bearer $token")
                    }
                }
            }
            if (!response.status.isSuccess()) {
                throw parseFailure(response.status.value, response.bodyAsTextSafe())
            }
            response.parseEnvelope<UserDto>().toDomain()
        } catch (e: Exception) {
            throw e.toAgent567Exception()
        }

    suspend fun updateDisplayName(expectedId: Long, expectedUsername: String, displayName: String): User {
        val clean = displayName.trim()
        require(clean.isNotBlank() && clean.length <= 20) { "昵称需为 1–20 个字符" }
        val current = me()
        require(current.id == expectedId && current.username == expectedUsername) { "账号已变化，请重新打开个人资料" }
        val response = executeWithAuthRefresh { token ->
            bareClient.put("${config.apiBaseUrl.trimEnd('/')}/api/user/self") {
                header(HttpHeaders.Authorization, "Bearer $token")
                header(HttpHeaders.Origin, cookieRequestOrigin())
                contentType(ContentType.Application.Json)
                setBody(buildJsonObject { put("username", expectedUsername); put("display_name", clean) }.toString())
            }
        }
        val body = response.bodyAsTextSafe()
        if (!response.status.isSuccess()) throw parseFailure(response.status.value, body)
        val root = Agent567Json.parseToJsonElement(body) as? JsonObject
        if ((root?.get("success") as? JsonPrimitive)?.content != "true") throw parseFailure(response.status.value, body)
        // The update response may omit data. Keep the verified account snapshot;
        // refreshing the profile is separate and must not turn a successful save into a false failure.
        return current.copy(nickname = clean)
    }

    suspend fun updatePassword(expected: User, originalPassword: String, newPassword: String) {
        require(originalPassword.isNotEmpty() && newPassword.length in 8..20) { "请填写当前密码，新密码需为 8–20 个字符" }
        val current = verifiedProfile(expected)
        val (root, sentTokens) = writeProfileChange(current, "/api/user/self", buildJsonObject {
            put("username", current.username)
            put("display_name", current.nickname)
            put("original_password", originalPassword)
            put("password", newPassword)
        }, put = true)
        val newAccess = (root["data"] as? JsonObject)?.get("access_token")?.jsonPrimitive?.contentOrNull
        if (!newAccess.isNullOrBlank()) {
            check(sentTokens != null && tokenRefresher.replaceSessionIfCurrent(sentTokens, newAccess, sentTokens.refreshToken)) { "账号已变化，请重新登录" }
        }
    }

    suspend fun sendBindingEmailCode(expected: User, email: String) {
        verifiedProfile(expected)
        require(email.trim().matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))) { "请输入有效的邮箱地址" }
        sendVerificationCode(email.trim())
    }

    suspend fun bindEmail(expected: User, email: String, code: String): User {
        val clean = email.trim()
        require(clean.length <= 254 && clean.matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) && code.isNotBlank()) { "请填写有效邮箱和验证码" }
        val current = verifiedProfile(expected)
        writeProfileChange(current, "/api/oauth/email/bind", buildJsonObject { put("email", clean); put("code", code.trim()) }, put = false)
        return current.copy(email = clean)
    }

    private suspend fun verifiedProfile(expected: User): User = me().also {
        require(it.id == expected.id && it.username == expected.username) { "账号已变化，请重新打开个人资料" }
    }

    private suspend fun writeProfileChange(current: User, path: String, body: JsonObject, put: Boolean): Pair<JsonObject, org.agent567.android.core.auth.StoredTokens?> {
        var sentTokens: org.agent567.android.core.auth.StoredTokens? = null
        val response = executeWithAuthRefresh { token ->
            sentTokens = tokenStore.snapshot()
            bareClient.request("${config.apiBaseUrl.trimEnd('/')}$path") {
                method = if (put) HttpMethod.Put else HttpMethod.Post
                header(HttpHeaders.Authorization, "Bearer $token")
                header("New-Api-User", current.id.toString())
                header(HttpHeaders.Origin, cookieRequestOrigin())
                contentType(ContentType.Application.Json)
                setBody(body.toString())
            }
        }
        val text = response.bodyAsTextSafe()
        if (!response.status.isSuccess()) throw parseFailure(response.status.value, text)
        val root = Agent567Json.parseToJsonElement(text) as? JsonObject
        if ((root?.get("success") as? JsonPrimitive)?.content != "true") throw parseFailure(response.status.value, text)
        return root to sentTokens
    }

    suspend fun subscriptionMe(): SubscriptionStatus {
        val user = me()
        val cents = (user.quota.toDouble() / 500000.0 * 100.0 + 0.5).toLong()
        val usdStr = "${cents / 100}.${(cents % 100).toString().padStart(2, '0')}"
        return SubscriptionStatus(
            active = true,
            isDefault = true,
            goEnabled = true,
            tierName = "567 API",
            badgeText = "567",
            description = "额度: $$usdStr",
        )
    }

    suspend fun getAvailableGroups(): Map<String, ApiGroupInfoDto> {
        return try {
            val response = executeWithAuthRefresh { token ->
                bareClient.get("${config.apiBaseUrl.trimEnd('/')}/api/user/groups") {
                    if (token.isNotBlank()) {
                        header(HttpHeaders.Authorization, "Bearer $token")
                    }
                }
            }
            val text = response.bodyAsTextSafe()
            val element = org.agent567.android.core.net.Agent567Json.parseToJsonElement(text)
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

    suspend fun fetchGroupModels(groupName: String?): List<String> {
        val patToken = tokenStore.accessToken

        // 1. 如果有登录 Token，先尝试调用 567 API 用户模型列表接口（有 group 则查指定分组，无 group 则查默认可用）
        if (!patToken.isNullOrBlank()) {
            try {
                val query = if (!groupName.isNullOrBlank()) {
                    "?group=${java.net.URLEncoder.encode(groupName, "UTF-8")}"
                } else {
                    ""
                }
                val url = "${config.apiBaseUrl.trimEnd('/')}/api/user/models$query"
                val res = executeWithAuthRefresh { token ->
                    bareClient.get(url) {
                        header(HttpHeaders.Authorization, "Bearer $token")
                    }
                }
                val text = res.bodyAsTextSafe()
                if (res.status.isSuccess()) {
                    val root = org.agent567.android.core.net.Agent567Json.parseToJsonElement(text)
                    val ids = extractModelIds(root)
                    if (ids.isNotEmpty()) {
                        rememberModelContexts(root, groupName)
                        preferences?.setCachedGroupModels(groupName, ids)
                        return ids
                    }
                }
            } catch (_: Exception) {
            }
        }

        // 2. 如果 /api/user/models 没拿到，获取或解析分组专属 API Key (sk-...)，请求标准 /v1/models
        return try {
            val res = modelRequest(groupName) { keyToUse ->
            bareClient.get(config.gatewayBaseUrl.trimEnd('/') + "/v1/models") {
                if (!keyToUse.isNullOrBlank()) {
                    header(HttpHeaders.Authorization, "Bearer $keyToUse")
                }
                if (!groupName.isNullOrBlank()) {
                    header("X-567-Group", java.net.URLEncoder.encode(groupName, "UTF-8"))
                }
            }
            }
            val text = res.bodyAsTextSafe()
            if (!res.status.isSuccess()) throw parseFailure(res.status.value, text)
            val root = org.agent567.android.core.net.Agent567Json.parseToJsonElement(text)
            val ids = extractModelIds(root)
            if (ids.isNotEmpty()) {
                rememberModelContexts(root, groupName)
                preferences?.setCachedGroupModels(groupName, ids)
            }
            ids
        } catch (_: Exception) {
            emptyList()
        }
    }

    suspend fun goModels(activeGroup: String? = null): ModelsCatalog {
        var modelIds = fetchGroupModels(activeGroup)
        if (modelIds.isEmpty() && preferences != null) {
            modelIds = preferences.getCachedGroupModels(activeGroup)
        }
        if (modelIds.isEmpty()) {
            return ModelsCatalog()
        }
        if (modelIds.any { contexts(activeGroup)[it]?.takeIf { entry -> entry.isFresh(System.currentTimeMillis()) }?.metadata?.capacity == null }) {
            refreshContextMetadata(activeGroup)
        }
        val models = modelIds.map { id ->
            val isReasoning = id.contains("reasoner", ignoreCase = true) ||
                    id.contains("r1", ignoreCase = true) ||
                    id.contains("o1", ignoreCase = true) ||
                    id.contains("o3", ignoreCase = true) ||
                    id.contains("thinking", ignoreCase = true) ||
                    id.contains("sol", ignoreCase = true)
            resolveContext(LlmModel(
                id = id,
                modelId = id,
                name = id,
                providerName = activeGroup ?: "567 API",
                reasoning = isReasoning,
            ), activeGroup)
        }
        val provider = ProviderModels(name = activeGroup ?: "567 API", models = models)
        return ModelsCatalog(providers = mapOf("agent567-go" to provider))
    }

    fun resolveContext(model: LlmModel, group: String?, useManual: Boolean = true): LlmModel = resolveModelContext(model,
        contexts(group)[model.id]?.takeIf { it.isFresh(System.currentTimeMillis()) }?.metadata,
        if (useManual) preferences?.getModelContextOverride(group, model.id, config.serverUrl) else null)

    private fun contexts(group: String?): Map<String, CachedModelContext> = contextMetadata.computeIfAbsent(group.orEmpty()) {
        preferences?.getCachedModelContexts(group, config.serverUrl).orEmpty()
    }

    private fun rememberModelContexts(root: kotlinx.serialization.json.JsonElement, group: String?) {
        val metadata = parseModelContextMetadata(root)
        if (metadata.isEmpty()) return
        val now = System.currentTimeMillis()
        contextMetadata.compute(group.orEmpty()) { _, previous ->
            (previous ?: preferences?.getCachedModelContexts(group, config.serverUrl).orEmpty()).filterValues { it.isFresh(now) } + metadata.mapValues { CachedModelContext(it.value, now) }
        }
        preferences?.setCachedModelContexts(group, metadata, config.serverUrl)
    }

    private val contextMetadata = ConcurrentHashMap<String, Map<String, CachedModelContext>>()
    private val contextMetadataRequests = ConcurrentHashMap<String, Long>()

    private suspend fun refreshContextMetadata(group: String?) {
        val now = System.currentTimeMillis()
        var shouldRequest = false
        contextMetadataRequests.compute(group.orEmpty()) { _, previous ->
            if (previous != null && now >= previous && now - previous < MODEL_CONTEXT_CACHE_TTL_MS) previous
            else now.also { shouldRequest = true }
        }
        if (!shouldRequest) return
        try {
            val apiKey = ensureApiKeyForGroup(group)
            if (apiKey.isBlank()) return
            val response = bareClient.get(config.gatewayBaseUrl.trimEnd('/') + "/v1/models") {
                header(HttpHeaders.Authorization, "Bearer $apiKey")
                if (!group.isNullOrBlank()) header("X-567-Group", java.net.URLEncoder.encode(group, "UTF-8"))
                timeout { requestTimeoutMillis = 8_000; connectTimeoutMillis = 5_000 }
            }
            if (response.status.isSuccess()) rememberModelContexts(Agent567Json.parseToJsonElement(response.bodyAsTextSafe()), group)
        } catch (error: CancellationException) {
            contextMetadataRequests.remove(group.orEmpty(), now)
            throw error
        } catch (_: Exception) {
            contextMetadataRequests.remove(group.orEmpty(), now)
        }
    }

    private val groupCredentials = GroupApiCredentials(
        tokenStore, preferences,
        { preferences?.serviceIdentity(config.apiBaseUrl) ?: serviceIdentity(config.apiBaseUrl) },
        { tokenRefresher.sessionVersion },
    ) { method, path, body, version ->
        executeWithAuthRefresh(version) { token ->
            bareClient.request("${config.apiBaseUrl.trimEnd('/')}$path") {
                this.method = HttpMethod.parse(method)
                header(HttpHeaders.Authorization, "Bearer $token")
                if (body != null) setBody(body.toString())
            }
        }
    }

    suspend fun cleanupGroupToken(groupName: String?) = groupCredentials.cleanup(groupName)
    suspend fun ensureApiKeyForGroup(groupName: String?): String = groupCredentials.get(groupName)

    private suspend fun modelRequest(group: String?, action: suspend (String) -> HttpResponse): HttpResponse {
        val version = tokenRefresher.sessionVersion
        val key = ensureApiKeyForGroup(group)
        val response = action(key)
        if (response.status.value != 401 || tokenStore.accessToken.orEmpty().startsWith("sk-")) return response
        if (version != tokenRefresher.sessionVersion) throw Agent567Exception.Unauthorized()
        val replacement = groupCredentials.get(group, rejectedKey = key)
        return if (replacement != key) action(replacement) else response
    }

    suspend fun generateImage(
        prompt: String,
        model: String,
        groupName: String? = null,
        size: String = "1024x1024",
        referenceImages: List<String> = emptyList(),
    ): GeneratedImageResult = withContext(Dispatchers.Default) {
        suspend fun requestImages(): GeneratedImageResult {
            val editing = referenceImages.isNotEmpty()
            require(referenceImages.size <= 6) { "Too many reference images" }
            val references = referenceImages.mapIndexed { index, image ->
                require(!image.startsWith("http")) { "Reference images must be attached image data" }
                val encoded = image.substringAfter("base64,", image)
                require(encoded.length <= 16 * 1024 * 1024) { "Reference image is too large" }
                val bytes = kotlin.io.encoding.Base64.decode(encoded)
                require(bytes.size <= 12 * 1024 * 1024) { "Reference image is too large" }
                val file = requireNotNull(generatedImageFile(bytes)) { "Unsupported reference image data" }
                Triple(index, file.mimeType, bytes)
            }
            require(references.sumOf { it.third.size } <= 12 * 1024 * 1024) { "Reference images are too large" }
            val response = modelRequest(groupName) { apiKey ->
                val security = org.agent567.android.core.net.SecurityHeaders.generate(
                    deviceId = "mobile-${apiKey.hashCode().toUInt().toString(16)}",
                    extraContext = if (!groupName.isNullOrBlank()) mapOf("X-567-Group" to java.net.URLEncoder.encode(groupName, "UTF-8")) else emptyMap(),
                )
                bareClient.post(config.gatewayBaseUrl.trimEnd('/') + if (editing) "/v1/images/edits" else "/v1/images/generations") {
                    timeout { requestTimeoutMillis = IMAGE_GENERATION_TIMEOUT_MS; socketTimeoutMillis = IMAGE_GENERATION_TIMEOUT_MS }
                    if (editing) {
                        setBody(io.ktor.client.request.forms.MultiPartFormDataContent(io.ktor.client.request.forms.formData {
                            append("model", model); append("prompt", prompt); append("n", "1"); append("size", size)
                            for ((index, mime, bytes) in references) {
                                val extension = when (mime) { "image/jpeg" -> "jpg"; "image/webp" -> "webp"; else -> "png" }
                                append(if (references.size == 1) "image" else "image[]", bytes, io.ktor.http.Headers.build {
                                    append(HttpHeaders.ContentType, mime)
                                    append(HttpHeaders.ContentDisposition, "filename=\"reference-$index.$extension\"")
                                })
                            }
                        }))
                    } else {
                        contentType(ContentType.Application.Json)
                        setBody(buildJsonObject { put("model", model); put("prompt", prompt); put("n", 1); put("size", size) }.toString())
                    }
                    if (apiKey.isNotBlank()) header(HttpHeaders.Authorization, "Bearer $apiKey")
                    for ((key, value) in security) header(key, value)
                }
            }
            val text = response.bodyAsTextSafe()
            if (!response.status.isSuccess()) throw parseFailure(response.status.value, text)
            return extractGeneratedImage(text, prompt)
        }

        // 辅助方法：调用 /v1/chat/completions 多模态生图/改图
        suspend fun tryChatCompletions(): GeneratedImageResult {
            val chatUrl = config.gatewayBaseUrl.trimEnd('/') + "/v1/chat/completions"
            val chatBody = buildJsonObject {
                put("model", model)
                put("modalities", JsonArray(listOf(JsonPrimitive("text"), JsonPrimitive("image"))))
                put("messages", kotlinx.serialization.json.buildJsonArray {
                    add(buildJsonObject {
                        put("role", "system")
                        put("content", "You are an AI image generator. Please generate and output the image directly or provide the image URL.")
                    })
                    add(buildJsonObject {
                        put("role", "user")
                        if (referenceImages.isEmpty()) {
                            put("content", "Please generate an image for:\n$prompt")
                        } else {
                            put("content", kotlinx.serialization.json.buildJsonArray {
                                add(buildJsonObject {
                                    put("type", "text")
                                    put("text", "Please generate/edit the image based on the provided reference image(s) and prompt:\n$prompt")
                                })
                                for (img in referenceImages) {
                                    val finalUrl = referenceImageDataUrl(img)
                                    add(buildJsonObject {
                                        put("type", "image_url")
                                        put(
                                            "image_url",
                                            buildJsonObject {
                                                put("url", finalUrl)
                                            },
                                        )
                                    })
                                }
                            })
                        }
                    })
                })
                put("stream", false)
            }
            val chatRes = modelRequest(groupName) { apiKey ->
            val secHeaders = org.agent567.android.core.net.SecurityHeaders.generate(
                deviceId = "mobile-${apiKey.hashCode().toUInt().toString(16)}",
                extraContext = if (!groupName.isNullOrBlank()) mapOf("X-567-Group" to java.net.URLEncoder.encode(groupName, "UTF-8")) else emptyMap()
            )

            bareClient.post(chatUrl) {
                timeout {
                    requestTimeoutMillis = IMAGE_GENERATION_TIMEOUT_MS
                    socketTimeoutMillis = IMAGE_GENERATION_TIMEOUT_MS
                }
                setBody(chatBody.toString())
                contentType(ContentType.Application.Json)
                if (apiKey.isNotBlank()) {
                    header(HttpHeaders.Authorization, "Bearer $apiKey")
                }
                for ((k, v) in secHeaders) {
                    header(k, v)
                }
            }

            }
            val chatText = chatRes.bodyAsTextSafe()
            if (!chatRes.status.isSuccess()) {
                throw parseFailure(chatRes.status.value, chatText)
            }

            return extractGeneratedImage(chatText, prompt)
        }

        // Pick one image protocol before sending. Never replay a potentially billed request
        // merely because the response had no image or the provider rejected the protocol.
        if (model.contains("gemini", ignoreCase = true)) tryChatCompletions() else requestImages()
    }

    private fun referenceImageDataUrl(value: String): String {
        if (value.startsWith("http://") || value.startsWith("https://")) return value
        require(value.length <= org.agent567.android.core.model.MAX_IMAGE_PAYLOAD_BASE64_CHARS + 64) { "Reference image is too large" }
        val bytes = runCatching { kotlin.io.encoding.Base64.decode(value.substringAfter("base64,", value)) }.getOrNull()
        val image = bytes?.let(::generatedImageFile) ?: throw IllegalArgumentException("Unsupported reference image data")
        return "data:${image.mimeType};base64,${image.base64}"
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
            val inferenceApi = preferences?.getModelInferenceApi(groupName, model, config.serverUrl)
                ?: org.agent567.android.core.chat.InferenceApi.automatic(model, groupName)
            val wireMessages = ChatRequestEncoder.encodeMessages(messages)
            val bodyJson = buildJsonObject {
                put("model", model)
                put("messages", kotlinx.serialization.json.JsonArray(wireMessages))
                put("stream", true)
                put("stream_options", buildJsonObject { put("include_usage", true) })
                if (temperature != null) {
                    put("temperature", temperature)
                }
                if (!imageGenModel.isNullOrBlank()) {
                    put("tools", kotlinx.serialization.json.buildJsonArray {
                        add(buildJsonObject {
                            put("type", "function")
                            put("function", buildJsonObject {
                                put("name", "generate_image")
                                put("description", "当用户要求画图、绘制图片、或者基于已有图片进行修改（以图生图、改图、垫图、多图融合创作）时调用该工具。系统具备向视觉模型传入多张参考图的能力。")
                                put("parameters", buildJsonObject {
                                    put("type", "object")
                                    put("properties", buildJsonObject {
                                        put("prompt", buildJsonObject {
                                            put("type", "string")
                                            put("description", "画面详细描述词。如果是改图或多图融合，请在提示词中详细说明需要保留什么、替换什么、如何融合各参考图元素以及画风细节。")
                                        })
                                        put("action", buildJsonObject {
                                            put("type", "string")
                                            put("description", "操作模式：'create' 为从零生成全新图片；'edit' 为在已有单张或多张图片的基础上进行修改或融合。")
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
            val requestBody = if (inferenceApi == org.agent567.android.core.chat.InferenceApi.Responses)
                org.agent567.android.core.chat.ResponsesRequestEncoder.encode(bodyJson, messages) else bodyJson
            val url = config.gatewayBaseUrl.trimEnd('/') + inferenceApi.path
            try {
                val sessionVersion = tokenRefresher.sessionVersion
                var token = ensureApiKeyForGroup(groupName)
                var repair = false
                do {
                    var retryCredential = false
                    var responseReceived = false
                    val secHeaders = org.agent567.android.core.net.SecurityHeaders.generate(
                        deviceId = "mobile-${token.hashCode().toUInt().toString(16)}",
                        extraContext = if (!groupName.isNullOrBlank()) mapOf("X-567-Group" to java.net.URLEncoder.encode(groupName, "UTF-8")) else emptyMap()
                    )
                    withChatConnectionRetry(responseReceived = { responseReceived }) {
                        bareClient.preparePost(url) {
                            // Model streams can take longer than ordinary API calls to produce
                            // the first token or pause between chunks; keep the REST client's
                            // short timeout from turning those pauses into apparent disconnects.
                            timeout {
                                requestTimeoutMillis = 600_000
                                socketTimeoutMillis = 600_000
                            }
                            setBody(requestBody.toString())
                            contentType(ContentType.Application.Json)
                            if (!token.isNullOrBlank()) {
                                header(HttpHeaders.Authorization, "Bearer $token")
                            }
                            for ((k, v) in secHeaders) {
                                header(k, v)
                            }
                            header(HttpHeaders.Accept, "text/event-stream")
                        }.execute { response ->
                            responseReceived = true
                            if (response.status.value == 401 && !repair && !tokenStore.accessToken.orEmpty().startsWith("sk-")) {
                                retryCredential = true
                                return@execute
                            }
                            if (!response.status.isSuccess()) {
                                val text = response.bodyAsTextSafe()
                                emit(ChatStreamEvent.Error(parseFailure(response.status.value, text)))
                                return@execute
                            }

                            val channel = response.bodyAsChannel()
                            var sawDone = false
                            var sawFinished = false
                            var sawAnyEvent = false
                            val bufferedLines = mutableListOf<String>()
                            var bufferedChars = 0
                            val sseParser = OpenAiSseStreamParser()
                            val responsesParser = if (inferenceApi == org.agent567.android.core.chat.InferenceApi.Responses)
                                org.agent567.android.core.chat.ResponsesSseStreamParser() else null
                            var sawSse = false

                            while (!channel.isClosedForRead) {
                                val line = channel.readUTF8Line(MAX_SSE_LINE_CHARS) ?: break
                                if (line.length >= MAX_SSE_LINE_CHARS) {
                                    emit(ChatStreamEvent.Error(Agent567Exception.Protocol("流式响应单行超过安全长度限制")))
                                    return@execute
                                }
                                val trimmed = line.trim()
                                if (trimmed.startsWith(":") || (trimmed.isEmpty() && responsesParser == null)) continue
                                if (trimmed.startsWith("data:") || trimmed.startsWith("event:")) sawSse = true
                                if (!sawAnyEvent && !sawSse && bufferedChars < MAX_NON_STREAM_FALLBACK_CHARS) {
                                    bufferedLines.add(line.take(MAX_NON_STREAM_FALLBACK_CHARS - bufferedChars))
                                    bufferedChars += line.length + 1
                                }

                                val events = responsesParser?.parseLine(line) ?: sseParser.parseLine(line)
                                for (event in events) {
                                    sawAnyEvent = true
                                    if (event is ChatStreamEvent.Done) {
                                        sawDone = true
                                    }
                                    if (event is ChatStreamEvent.Finished) sawFinished = true
                                    emit(event)
                                    if (event is ChatStreamEvent.Error) {
                                        return@execute
                                    }
                                }
                                if (sawAnyEvent) bufferedLines.clear()
                            }

                            for (event in responsesParser?.finish().orEmpty()) {
                                sawAnyEvent = true
                                if (event is ChatStreamEvent.Done) sawDone = true
                                if (event is ChatStreamEvent.Finished) sawFinished = true
                                emit(event)
                                if (event is ChatStreamEvent.Error) return@execute
                            }

                            // 兜底保障：如果循环读完没有产生任何有效 SSE 事件（例如返回了非流式 JSON）
                            if (!sawAnyEvent && !sawSse && bufferedChars > MAX_NON_STREAM_FALLBACK_CHARS) {
                                emit(ChatStreamEvent.Error(Agent567Exception.Protocol("服务器返回内容过大，无法安全解析")))
                                return@execute
                            }
                            if (!sawAnyEvent && !sawSse && bufferedLines.isNotEmpty()) {
                                val fullText = bufferedLines.joinToString("\n")
                                val fallbackEvents = responsesParser?.parseNonStreamJson(fullText) ?: OpenAiSseParser.parseNonStreamJson(fullText)
                                if (fallbackEvents.isNotEmpty()) {
                                    for (ev in fallbackEvents) {
                                        emit(ev)
                                        if (ev is ChatStreamEvent.Error) return@execute
                                        if (ev is ChatStreamEvent.Done) {
                                            sawDone = true
                                        }
                                    }
                                }
                            }

                            if (!sawDone) {
                                if (sawFinished) emit(ChatStreamEvent.Done)
                                else {
                                    emit(ChatStreamEvent.Error(Agent567Exception.Protocol("流式响应意外结束，未收到完整响应标记")))
                                    return@execute
                                }
                            }
                        }
                    }
                    if (retryCredential) {
                        if (sessionVersion != tokenRefresher.sessionVersion) throw Agent567Exception.Unauthorized()
                        val replacement = groupCredentials.get(groupName, rejectedKey = token)
                        if (replacement == token) throw Agent567Exception.Api(401, null, "模型授权已失效，暂时无法恢复，请刷新账号资料后重试")
                        token = replacement
                        repair = true
                    }
                } while (retryCredential)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                emit(ChatStreamEvent.Error(e.toAgent567Exception()))
            }
        }


    suspend fun checkAppUpdate(): AppUpdateCheckResult {
        return try {
            val url = "https://api.github.com/repos/Chinachani/567-agent/releases/latest"
            val response = bareClient.get(url) {
                header(HttpHeaders.UserAgent, "567-Agent-Mobile")
            }
            val text = response.bodyAsTextSafe()
            if (!response.status.isSuccess()) {
                throw Agent567Exception.Api(
                    httpStatus = response.status.value,
                    code = null,
                    message = "GitHub release lookup failed",
                    rawBody = text,
                )
            }
            val root = org.agent567.android.core.net.Agent567Json.parseToJsonElement(text) as? kotlinx.serialization.json.JsonObject
            val tagName = (root?.get("tag_name") as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()
            if (tagName.isBlank()) {
                throw Agent567Exception.Api(
                    httpStatus = response.status.value,
                    code = null,
                    message = "GitHub response did not include a release tag",
                    rawBody = text,
                )
            }
            val body = (root?.get("body") as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()
            val assets = root?.get("assets") as? kotlinx.serialization.json.JsonArray
            val apk = org.agent567.android.core.updates.releaseApkAsset(assets)
            val cleanTag = tagName.removePrefix("v").trim()
            val current = AppVersion.NAME
            val hasUpdate = isNewerVersion(cleanTag, current)
            AppUpdateCheckResult(
                hasUpdate = hasUpdate,
                latestVersion = tagName.ifBlank { "v$current" },
                currentVersion = "v$current",
                releaseNotes = body,
                apkUrl = resolvePublicReleaseApkUrl(apk?.url),
                apkName = apk?.name,
                apkSize = apk?.size,
                apkSha256 = apk?.sha256,
            )
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            AppUpdateCheckResult(
                hasUpdate = false,
                latestVersion = "v${AppVersion.NAME}",
                currentVersion = "v${AppVersion.NAME}",
                releaseNotes = "",
                apkUrl = null,
                error = e.message ?: "检查更新失败",
            )
        }
    }

    /** Only rewrite GitHub's public release asset URL; the metadata request above stays anonymous/direct. */
    private fun resolvePublicReleaseApkUrl(assetUrl: String?): String? {
        val candidate = assetUrl?.takeIf { it.isNotBlank() } ?: return null
        val parsed = runCatching { Url(candidate) }.getOrNull() ?: return null
        if (parsed.protocol.name != "https" || parsed.host != "github.com" || parsed.user != null || parsed.password != null) {
            return null
        }
        if ('?' in candidate || '#' in candidate || !parsed.encodedPath.startsWith("/") ||
            !parsed.encodedPath.contains("/releases/download/")
        ) {
            return null
        }
        val source = preferences?.downloadSource ?: org.agent567.android.app.AppPreferences.DOWNLOAD_SOURCE_GITHUB
        return when (source) {
            org.agent567.android.app.AppPreferences.DOWNLOAD_SOURCE_GH_PROXY -> "https://gh-proxy.com/$candidate"
            org.agent567.android.app.AppPreferences.DOWNLOAD_SOURCE_CUSTOM ->
                normalizeGitHubDownloadPrefix(preferences?.customPrefix)?.let { "$it$candidate" }
            else -> candidate
        }
    }

    private suspend fun postAuth(path: String, body: Any): AuthSession =
        try {
            val response =
                client.post(path) {
                    setBody(body)
                }
            val session = response.parseEnvelope<LoginResponseDto>().toSession()
            tokenRefresher.installSession(session.accessToken, session.refreshToken)
            session
        } catch (e: Exception) {
            throw e.toAgent567Exception()
        }
}

private fun extractModelIds(root: kotlinx.serialization.json.JsonElement?): List<String> {
    if (root == null) return emptyList()
    val dataArr = when (root) {
        is kotlinx.serialization.json.JsonArray -> root
        is kotlinx.serialization.json.JsonObject -> {
            (root["data"] as? kotlinx.serialization.json.JsonArray)
                ?: (root["models"] as? kotlinx.serialization.json.JsonArray)
        }
        else -> null
    } ?: return emptyList()

    return dataArr.mapNotNull { item ->
        when (item) {
            is kotlinx.serialization.json.JsonPrimitive -> item.content.takeIf { it.isNotBlank() }
            is kotlinx.serialization.json.JsonObject -> {
                val id = (item["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                    ?: (item["name"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                    ?: (item["model"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                id?.takeIf { it.isNotBlank() }
            }
            else -> null
        }
    }
}


private suspend fun HttpResponse.bodyAsTextSafe(): String =
    runCatching { bodyAsText() }.getOrDefault("")
