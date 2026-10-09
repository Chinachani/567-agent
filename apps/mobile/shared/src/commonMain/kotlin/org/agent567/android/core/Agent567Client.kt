package org.agent567.android.core

import io.ktor.client.HttpClient
import org.agent567.android.core.api.Agent567Api
import org.agent567.android.core.auth.SettingsTokenStore
import org.agent567.android.core.auth.TokenStore
import org.agent567.android.core.net.UnauthorizedHandler
import org.agent567.android.core.net.TokenRefresher
import org.agent567.android.core.net.createBareHttpClient
import org.agent567.android.core.net.createAgent567HttpClient

/**
 * Agent567 移动端底层入口：鉴权、模型清单、订阅、Gateway 流式对话。
 *
 * ```kotlin
 * val client = Agent567Client.create(
 *   Agent567Config(serverUrl = "https://example.com/api/v1"),
 * )
 * client.auth.loginWithEmailPassword(email, password)
 * client.chat.stream(modelId, messages).collect { ... }
 * client.close()
 * ```
 */
class Agent567Client private constructor(
    val config: Agent567Config,
    val tokenStore: TokenStore,
    val auth: AuthRepository,
    val models: ModelsRepository,
    val subscription: SubscriptionRepository,
    val chat: ChatRepository,
    private val httpClient: HttpClient,
    private val bareHttpClient: HttpClient,
) {
    fun close() {
        httpClient.close()
        bareHttpClient.close()
    }

    companion object {
        fun create(
            config: Agent567Config,
            tokenStore: TokenStore = SettingsTokenStore(),
            onUnauthorized: UnauthorizedHandler? = null,
            preferences: org.agent567.android.app.AppPreferences? = null,
        ): Agent567Client {
            val bare = createBareHttpClient(config)

            // TokenRefresher / Agent567Api 互相引用：先建 refresher 占位，再注入 api.refresh
            lateinit var api: Agent567Api
            val refresher =
                TokenRefresher(
                    tokenStore = tokenStore,
                    refreshAction = { refreshToken -> api.refreshTokensWithAccountRecovery(refreshToken) },
                    onUnauthorized = onUnauthorized,
                    onRenewed = { outcome ->
                        preferences?.let { prefs ->
                            prefs.authToken = outcome.accessToken
                            prefs.authRefreshToken = outcome.refreshToken
                            outcome.user?.let { user ->
                                prefs.authUsername = user.nickname.ifBlank { user.username }
                                prefs.authQuotaUsd = user.quotaUsd
                                prefs.authUserId = user.id
                            }
                        }
                    },
                )
            val client = createAgent567HttpClient(config, tokenStore, refresher)
            api = Agent567Api(client, bare, config, tokenStore, refresher, preferences)

            return Agent567Client(
                config = config,
                tokenStore = tokenStore,
                auth = AuthRepository(api, tokenStore, refresher),
                models = ModelsRepository(api),
                subscription = SubscriptionRepository(api),
                chat = ChatRepository(api),
                httpClient = client,
                bareHttpClient = bare,
            )
        }
    }
}
