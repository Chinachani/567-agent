package org.agent567.android.core.api

import androidx.lifecycle.viewModelScope
import com.russhwolf.settings.MapSettings
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import org.agent567.android.app.AppContainer
import org.agent567.android.app.AppPreferences
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.net.NetworkAvailability
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.ui.AppViewModel
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class AccountVerificationHostTest {
    @Test fun cachedAccountReportsOfflineVerificationThenRecoversWithoutLogout() = runBlocking {
        Dispatchers.setMain(Dispatchers.Unconfined)
        var available = false
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            request.requestBody.close()
            val body = if (!available) """{"success":false,"message":"unavailable"}""" else when(request.requestURI.path) {
                "/api/user/self" -> """{"success":true,"data":{"id":7,"username":"verified","quota":500000}}"""
                "/api/user/models" -> """{"success":true,"data":["model"]}"""
                else -> """{"success":true,"data":{}}"""
            }
            val bytes = body.toByteArray()
            request.sendResponseHeaders(if (available) 200 else 503, bytes.size.toLong())
            request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val preferences = AppPreferences(MapSettings()).apply {
            setServerUrl("http://127.0.0.1:${server.address.port}")
            authUsername = "cached"
            authUserId = 7
            setCachedGroupModels(null, listOf("model"))
        }
        val tokens = InMemoryTokenStore("sk-test", "sk-test")
        val container = AppContainer(preferences, tokens, SettingsSessionStore(MapSettings(), Dispatchers.IO),
            networkAvailability = MutableStateFlow(NetworkAvailability.Available), loadServiceRoutes = { emptyList() })
        val vm = AppViewModel(container)
        try {
            val offline = withTimeout(20_000) { vm.state.first { it.bootstrapped && it.accountVerificationMessage != null } }
            assertEquals("cached", offline.user?.username)
            assertFalse(offline.accountVerifying)
            assertEquals("sk-test", tokens.accessToken)
            available = true
            vm.refreshQuota()
            val restored = withTimeout(20_000) { vm.state.first { !it.quotaRefreshing && it.user?.username == "verified" } }
            assertNull(restored.accountVerificationMessage)
            assertEquals("sk-test", tokens.accessToken)
        } finally {
            vm.viewModelScope.coroutineContext.job.cancelAndJoin(); container.close(); server.stop(0); Dispatchers.resetMain()
        }
    }
}
