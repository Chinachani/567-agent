package org.agent567.android.app

import org.agent567.android.AppVersion

import com.russhwolf.settings.Settings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.agent567.android.core.Agent567Client
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.auth.SettingsTokenStore
import org.agent567.android.core.auth.createPlatformSecretStore
import org.agent567.android.core.auth.TokenStore
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.domain.conversation.ConversationRouter
import org.agent567.android.domain.conversation.RemoteConversationGateway
import org.agent567.android.domain.conversation.RelayRemoteConversationGateway
import org.agent567.android.domain.session.SessionStore
import org.agent567.android.core.ServiceRoute
import org.agent567.android.core.ServiceRouteResult
import org.agent567.android.core.ServiceRouteCatalog
import org.agent567.android.core.net.ServiceRouteProbe
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.time.TimeSource

/**
 * 进程级依赖容器。内置线路共用账号存储，各自保留不可变的客户端供在途任务使用。
 */
class AppContainer(
    val preferences: AppPreferences = AppPreferences(),
    val tokenStore: TokenStore = SettingsTokenStore(),
    val sessionStore: SessionStore = SettingsSessionStore(),
    val remoteConversationGateway: RemoteConversationGateway = RelayRemoteConversationGateway(),
    val networkAvailability: StateFlow<org.agent567.android.core.net.NetworkAvailability> = org.agent567.android.core.net.platformNetworkAvailability(),
    private val checkServiceRoute: suspend (ServiceRoute, String?) -> Boolean = { route, token -> ServiceRouteProbe().check(route, token) },
    private val loadServiceRoutes: suspend () -> List<ServiceRoute> = { ServiceRouteProbe().discover() },
) {
    private val unauthorizedSignal = MutableStateFlow(0L)
    val unauthorizedEpoch: StateFlow<Long> = unauthorizedSignal.asStateFlow()

    private var clientRef: Agent567Client = createClient(preferences.serverUrl.value)
    // Retain immutable clients so switching never closes an ongoing stream/tool.
    private val routeClients = mutableMapOf(clientRef.config.apiBaseUrl to clientRef)
    private val routeSwitch = Mutex()
    private val routeDiscovery = Mutex()
    private var discoveryRetryAt = 0L

    suspend fun refreshServiceRoutes(force: Boolean = false): ServiceRouteCatalog = routeDiscovery.withLock {
        val cached = preferences.serviceRouteCatalog()
        val now = System.currentTimeMillis()
        if (!force && ((cached.updatedAt?.let { now - it in 0..300_000 } == true) || now < discoveryRetryAt)) return@withLock cached
        try {
            val routes = loadServiceRoutes()
            currentCoroutineContext().ensureActive()
            preferences.cacheServiceRoutes(routes)
            discoveryRetryAt = 0
            preferences.serviceRouteCatalog().copy(source = "live")
        } catch (error: Exception) {
            if (error is CancellationException && error !is TimeoutCancellationException) throw error
            discoveryRetryAt = now + 60_000
            preferences.serviceRouteCatalog().copy(refreshFailed = true)
        }
    }

    val client: Agent567Client
        get() = clientRef

    val conversationRouter =
        ConversationRouter(
            cloudStream = { modelId, messages, groupName, imageGenModel -> client.chat.stream(modelId, messages, groupName = groupName, imageGenModel = imageGenModel) },
            remoteGateway = remoteConversationGateway,
        )

    fun notifyUnauthorized() {
        unauthorizedSignal.value = unauthorizedSignal.value + 1
    }

    suspend fun probeServiceRoute(route: ServiceRoute): ServiceRouteResult {
        if (preferences.serviceRouteCatalog().routes.none { it.origin == route.origin }) return ServiceRouteResult(route, false, error = "unavailable")
        val start = TimeSource.Monotonic.markNow()
        return try {
            val ok = checkServiceRoute(route, null)
            ServiceRouteResult(route, ok, if (ok) start.elapsedNow().inWholeMilliseconds else null, if (ok) null else "invalid-response")
        } catch (_: TimeoutCancellationException) { ServiceRouteResult(route, false, error = "unreachable") }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { ServiceRouteResult(route, false, error = "unreachable") }
    }

    suspend fun selectServiceRoute(route: ServiceRoute): ServiceRouteResult = routeSwitch.withLock {
        if (preferences.findServiceRoute(preferences.serverUrl.value) == null) return@withLock ServiceRouteResult(route, false, error = "custom-server")
        val tokens = tokenStore.snapshot()
        val original = preferences.serverUrl.value
        val result = probeServiceRoute(route)
        if (!result.ok) return@withLock result
        try {
            if (tokens != null && !checkServiceRoute(route, tokens.accessToken)) return@withLock ServiceRouteResult(route, false, error = "account-rejected")
            currentCoroutineContext().ensureActive()
            if (tokens != tokenStore.snapshot() || original != preferences.serverUrl.value) return@withLock ServiceRouteResult(route, false, error = "account-changed")
            val next = routeClients.getOrPut(route.origin) { createClient(route.origin) }
            preferences.rememberServiceRoute(route)
            preferences.setServerUrl(route.origin)
            clientRef = next
            result
        } catch (_: TimeoutCancellationException) { ServiceRouteResult(route, false, error = "unreachable") }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { ServiceRouteResult(route, false, error = "unreachable") }
    }

    fun conversationRouterFor(client: Agent567Client): ConversationRouter = ConversationRouter(
        cloudStream = { modelId, messages, groupName, imageGenModel -> client.chat.stream(modelId, messages, groupName = groupName, imageGenModel = imageGenModel) },
        remoteGateway = remoteConversationGateway,
    )

    fun close() { routeClients.values.toSet().forEach { it.close() }; routeClients.clear() }

    private fun createClient(serverUrl: String): Agent567Client =
        Agent567Client.create(
            config =
                Agent567Config(
                    serverUrl = preferences.findServiceRoute(serverUrl)?.origin ?: serverUrl,
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
