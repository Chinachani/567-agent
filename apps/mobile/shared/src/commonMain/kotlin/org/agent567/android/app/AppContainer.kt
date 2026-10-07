package org.agent567.android.app

import org.agent567.android.AppVersion

import com.russhwolf.settings.Settings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.agent567.android.core.VettaClient
import org.agent567.android.core.VettaConfig
import org.agent567.android.core.auth.SettingsTokenStore
import org.agent567.android.core.auth.createPlatformSecretStore
import org.agent567.android.core.auth.TokenStore
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.domain.conversation.ConversationRouter
import org.agent567.android.domain.conversation.RemoteConversationGateway
import org.agent567.android.domain.conversation.RelayRemoteConversationGateway
import org.agent567.android.domain.session.SessionStore

/**
 * 进程级依赖容器。serverUrl 变更时重建 [VettaClient]，会话与 token 存储保持不变。
 */
class AppContainer(
    val preferences: AppPreferences = AppPreferences(),
    val tokenStore: TokenStore = SettingsTokenStore(),
    val sessionStore: SessionStore = SettingsSessionStore(),
    val remoteConversationGateway: RemoteConversationGateway = RelayRemoteConversationGateway(),
) {
    private val unauthorizedSignal = MutableStateFlow(0L)
    val unauthorizedEpoch: StateFlow<Long> = unauthorizedSignal.asStateFlow()

    private var clientRef: VettaClient = createClient(preferences.serverUrl.value)

    val client: VettaClient
        get() = clientRef

    val conversationRouter =
        ConversationRouter(
            cloudStream = { modelId, messages, groupName, imageGenModel -> client.chat.stream(modelId, messages, groupName = groupName, imageGenModel = imageGenModel) },
            remoteGateway = remoteConversationGateway,
        )

    fun notifyUnauthorized() {
        unauthorizedSignal.value = unauthorizedSignal.value + 1
    }

    @Synchronized
    fun recreateClient(serverUrl: String = preferences.serverUrl.value): VettaClient {
        runCatching { clientRef.close() }
        clientRef = createClient(serverUrl)
        return clientRef
    }

    private fun createClient(serverUrl: String): VettaClient =
        VettaClient.create(
            config =
                VettaConfig(
                    serverUrl = serverUrl,
                    userAgent = "567-agent-android/${AppVersion.NAME}",
                ),
            tokenStore = tokenStore,
            onUnauthorized = { notifyUnauthorized() },
            preferences = preferences,
        )

    companion object {
        fun createDefault(): AppContainer {
            val settings = Settings()
            val secrets = createPlatformSecretStore(settings)
            return AppContainer(
                preferences = AppPreferences(settings, secrets),
                tokenStore = SettingsTokenStore(settings, secretStore = secrets),
                sessionStore = SettingsSessionStore(
                    settings = settings,
                    imageFiles = org.agent567.android.domain.session.createPlatformMessageImageFileStore(),
                ),
            )
        }
    }
}
