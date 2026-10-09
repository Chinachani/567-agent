package org.agent567.android.core.net

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.auth.Auth
import io.ktor.client.plugins.auth.providers.BearerTokens
import io.ktor.client.plugins.auth.providers.bearer
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.plugins.logging.LogLevel
import io.ktor.client.plugins.logging.Logger
import io.ktor.client.plugins.logging.Logging
import io.ktor.client.request.header
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.auth.TokenStore
import org.agent567.android.core.error.Agent567Exception

/**
 * refresh 结果三态，与 desktop 主进程策略对齐：
 * - [Ok]：已换新 token
 * - [Unauthorized]：refresh 失效，应登出
 * - [Transient]：网络/5xx，保留会话
 */
sealed class RefreshOutcome {
    data class Ok(val accessToken: String, val refreshToken: String, val user: org.agent567.android.core.model.User? = null) : RefreshOutcome()

    data object Unauthorized : RefreshOutcome()

    data object Transient : RefreshOutcome()

    data object AccountRejected : RefreshOutcome()
}

fun interface UnauthorizedHandler {
    fun onUnauthorized()
}

internal fun createAgent567HttpClient(
    config: Agent567Config,
    tokenStore: TokenStore,
    tokenRefresher: TokenRefresher,
): HttpClient =
    HttpClient(platformHttpClientEngine()) {
        expectSuccess = false

        install(ContentNegotiation) {
            json(Agent567Json)
        }

        install(HttpTimeout) {
            // 流式对话可能很长；单次 REST 一般远低于此
            requestTimeoutMillis = 600_000
            connectTimeoutMillis = 30_000
            socketTimeoutMillis = 600_000
        }

        if (config.enableHttpLogging) {
            install(Logging) {
                logger =
                    object : Logger {
                        override fun log(message: String) {
                            println("[567agent-http] $message")
                        }
                    }
                level = LogLevel.HEADERS
                sanitizeHeader { header ->
                    header.equals(HttpHeaders.Authorization, ignoreCase = true) ||
                        header.equals(HttpHeaders.Cookie, ignoreCase = true) ||
                        header.equals(HttpHeaders.SetCookie, ignoreCase = true) ||
                        header.equals("Proxy-Authorization", ignoreCase = true)
                }
            }
        }

        install(Auth) {
            bearer {
                loadTokens {
                    val access = tokenStore.accessToken
                    val refresh = tokenStore.refreshToken
                    if (access.isNullOrBlank()) {
                        null
                    } else {
                        BearerTokens(access, refresh.orEmpty())
                    }
                }
                refreshTokens {
                    when (val outcome = tokenRefresher.refresh(oldTokens?.accessToken)) {
                        is RefreshOutcome.Ok ->
                            BearerTokens(outcome.accessToken, outcome.refreshToken)
                        RefreshOutcome.Unauthorized -> null
                        RefreshOutcome.Transient, RefreshOutcome.AccountRejected -> null
                    }
                }
                sendWithoutRequest { request ->
                    // true = 发送 Bearer；登录/refresh 等匿名接口必须为 false
                    val path = request.url.toString()
                    !isAnonymousAuthPath(path)
                }
            }
        }

        defaultRequest {
            url(config.apiBaseUrl.trimEnd('/') + "/")
            header(HttpHeaders.UserAgent, config.userAgent)
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Accept, ContentType.Application.Json.toString())
        }
    }

/**
 * 无 Auth 插件的裸客户端，专用于 refresh，避免递归。
 */
internal fun createBareHttpClient(config: Agent567Config): HttpClient =
    HttpClient(platformHttpClientEngine()) {
        expectSuccess = false
        install(ContentNegotiation) {
            json(Agent567Json)
        }
        install(HttpTimeout) {
            requestTimeoutMillis = 30_000
            connectTimeoutMillis = 15_000
            socketTimeoutMillis = 30_000
        }
        defaultRequest {
            url(config.apiBaseUrl.trimEnd('/') + "/")
            header(HttpHeaders.UserAgent, config.userAgent)
            contentType(ContentType.Application.Json)
            header(HttpHeaders.Accept, ContentType.Application.Json.toString())
        }
    }

internal fun isAnonymousAuthPath(path: String): Boolean {
    // 兼容完整 URL / 相对 path；统一成以 / 开头的 path 再 endsWith 匹配
    val raw = path.substringBefore('?').trimEnd('/')
    val pathOnly =
        when {
            "://" in raw -> {
                val afterScheme = raw.substringAfter("://")
                val afterHost = afterScheme.substringAfter('/', missingDelimiterValue = "")
                "/$afterHost"
            }
            raw.startsWith("/") -> raw
            else -> "/$raw"
        }
    return pathOnly.endsWith("/auth/login") ||
        pathOnly.endsWith("/api/user/login") ||
        pathOnly.endsWith("/auth/refresh") ||
        pathOnly.endsWith("/auth/logout") ||
        pathOnly.endsWith("/auth/sms/send") ||
        pathOnly.endsWith("/auth/sms/login") ||
        pathOnly.endsWith("/auth/email/code") ||
        pathOnly.endsWith("/auth/email/code/login") ||
        pathOnly.endsWith("/auth/email/password/login") ||
        pathOnly.endsWith("/auth/admin/login")
}

internal fun Throwable.toAgent567Exception(): Agent567Exception =
    when (this) {
        is Agent567Exception -> this
        else -> Agent567Exception.Network(message ?: "网络错误", this)
    }
