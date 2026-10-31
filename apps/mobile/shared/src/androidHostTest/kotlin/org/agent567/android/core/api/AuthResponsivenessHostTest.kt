package org.agent567.android.core.api

import com.russhwolf.settings.MapSettings
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.agent567.android.app.*
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.ui.AppViewModel
import org.agent567.android.ui.navigation.AppRoute
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class AuthResponsivenessHostTest {
    @Test fun loginBecomesVisibleBeforeCatalogAndLogoutRejectsLateProfileResponses() = runBlocking {
        Dispatchers.setMain(Dispatchers.Unconfined)
        val blocked = CountDownLatch(1); val release = CountDownLatch(1); val selfRequests = AtomicInteger()
        val executor = Executors.newCachedThreadPool()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.executor = executor
        server.createContext("/") { request ->
            try {
                val body = if (request.requestURI.path == "/api/user/self") {
                    if (selfRequests.incrementAndGet() > 1) { blocked.countDown(); release.await(10, TimeUnit.SECONDS) }
                    """{"success":true,"data":{"id":7,"username":"test","display_name":"Signed in","quota":500000}}"""
                } else """{"success":true,"data":{}}"""
                val bytes = body.toByteArray(); request.sendResponseHeaders(200, bytes.size.toLong()); request.responseBody.use { it.write(bytes) }
            } catch (_: java.io.IOException) { request.close() }
        }
        server.start()
        val tokens = InMemoryTokenStore()
        val preferences = AppPreferences(MapSettings()).apply { setServerUrl("http://127.0.0.1:${server.address.port}") }
        val container = AppContainer(preferences, tokens, SettingsSessionStore(MapSettings(), Dispatchers.IO), loadServiceRoutes = { emptyList() })
        val vm = AppViewModel(container)
        try {
            withTimeout(5_000) { vm.state.first { it.bootstrapped } }
            vm.login("isolated-token", "")
            withTimeout(5_000) { vm.state.first { it.user?.id == 7L && !it.authLoading && it.route != AppRoute.Login } }
            assertTrue(withContext(Dispatchers.IO) { blocked.await(5, TimeUnit.SECONDS) })
            assertTrue(vm.state.value.catalogLoading)
            vm.logout(false)
            assertNull(vm.state.value.user)
            assertEquals(AppRoute.Login, vm.state.value.route)
            withTimeout(5_000) { vm.state.first { !it.authLoading && it.user == null } }
            assertNull(tokens.accessToken)
            release.countDown()
            vm.openAccount()
            assertNull(vm.state.value.user)
            assertNull(preferences.authToken)
        } finally { release.countDown(); vm.viewModelScope.coroutineContext.job.cancelAndJoin(); container.close(); server.stop(0); executor.shutdownNow(); Dispatchers.resetMain() }
    }
}
