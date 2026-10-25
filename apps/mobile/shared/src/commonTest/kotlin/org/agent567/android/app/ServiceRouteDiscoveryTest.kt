package org.agent567.android.app

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import org.agent567.android.core.*
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.net.Agent567Json
import org.agent567.android.core.net.NetworkAvailability
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.ui.AppViewModel
import kotlin.test.*

@OptIn(ExperimentalCoroutinesApi::class)
class ServiceRouteDiscoveryTest {
    private val dispatcher = StandardTestDispatcher()
    @BeforeTest fun setup() { Dispatchers.setMain(dispatcher) }
    @AfterTest fun cleanup() { Dispatchers.resetMain() }

    @Test fun validatesPublicListAndDoesNotTrustUnlistedOrigins() {
        val routes = parseServiceRoutes(Agent567Json.parseToJsonElement("""[
          {"url":"https://a.567.wiki/v1/","route":"大陆"},
          {"url":"https://node3.567.wiki","route":"节点三"},
          {"url":"https://node3.567.wiki/v1"},
          {"url":"https://127.0.0.1"},
          {"url":"https://user:pass@a.567.wiki"},
          {"url":"https://a.567.wiki?token=x"},
          {"url":"http://a.567.wiki"}
        ]"""))
        assertEquals(listOf(ServiceRoute.Mainland.origin, "https://node3.567.wiki"), routes.map { it.origin })
        assertEquals("节点三", routes.last().name)
        assertNull(ServiceRoute.fromServer("https://node3.567.wiki"))
        assertNotNull(ServiceRoute.fromServer("https://node3.567.wiki/v1", routes))
        listOf("[]", "{}", "null", "[{\"url\":\"https://service.local\"}]").forEach {
            assertFails { parseServiceRoutes(Agent567Json.parseToJsonElement(it)) }
        }
    }

    @Test fun refreshSwitchRestartAndCacheCleanupKeepLoginCapacityAndAnActiveClient() = runTest(dispatcher) {
        val settings = MapSettings()
        val prefs = AppPreferences(settings)
        prefs.setModelContextOverride("B", "model", 128000)
        val tokens = InMemoryTokenStore("account-token", "refresh-cookie")
        val node = ServiceRoute("https://node3.567.wiki", "节点三")
        var fail = false
        var nodes = listOf(node)
        val checks = mutableListOf<Pair<String, String?>>()
        val container = AppContainer(preferences = prefs, tokenStore = tokens, sessionStore = SettingsSessionStore(MapSettings(), dispatcher), networkAvailability = MutableStateFlow(NetworkAvailability.Available), checkServiceRoute = { route, token -> checks.add(route.origin to token); true }, loadServiceRoutes = { if (fail) error("offline") else nodes })
        try {
            val running = container.client
            assertEquals("live", container.refreshServiceRoutes(true).source)
            assertEquals(ServiceRoute.Mainland.origin, prefs.serverUrl.value)
            assertTrue(container.selectServiceRoute(node).ok)
            assertEquals(listOf(node.origin to null, node.origin to "account-token"), checks)
            assertEquals(ServiceRoute.Mainland.origin, running.config.apiBaseUrl)
            assertEquals(node.origin, container.client.config.apiBaseUrl)
            assertEquals(128000L, prefs.getModelContextOverride("B", "model"))
            assertEquals("account-token", tokens.accessToken)
            fail = true
            assertTrue(container.refreshServiceRoutes(true).refreshFailed)
            assertEquals(node.origin, prefs.serverUrl.value)
            assertFalse(container.selectServiceRoute(ServiceRoute("https://unknown.567.wiki")).ok)
            assertEquals(2, checks.size)
            fail = false
            nodes = listOf(ServiceRoute.Germany)
            assertTrue(container.refreshServiceRoutes(true).routes.any { it.origin == node.origin })
            settings.remove("567agent.service-routes.catalog.v1")
            val restored = AppPreferences(settings)
            assertNotNull(restored.findServiceRoute(node.origin))
            assertEquals(128000L, restored.getModelContextOverride("B", "model"))
            assertEquals(node.origin, restored.serverUrl.value)
        } finally { container.close() }
    }

    @Test fun pickerShowsCachedChoicesBeforeDiscoveryAndClosingCancelsAnUncommittedSelection() = runTest(dispatcher) {
        val prefs = AppPreferences(MapSettings())
        val node = ServiceRoute("https://node3.567.wiki", "节点三")
        val discovery = CompletableDeferred<List<ServiceRoute>>()
        val checked = CompletableDeferred<Unit>()
        val selection = CompletableDeferred<Boolean>()
        val container = AppContainer(preferences = prefs, tokenStore = InMemoryTokenStore(), sessionStore = SettingsSessionStore(MapSettings(), dispatcher), networkAvailability = MutableStateFlow(NetworkAvailability.Available), loadServiceRoutes = { discovery.await() }, checkServiceRoute = { _, _ -> checked.complete(Unit); selection.await() })
        try {
            val vm = AppViewModel(container)
            advanceUntilIdle()
            vm.setServiceRoutePickerOpen(true)
            assertTrue(vm.state.value.serviceRoutePickerOpen)
            assertTrue(vm.state.value.serviceRouteCatalog.routes.contains(ServiceRoute.Mainland))
            assertTrue(vm.state.value.serviceRouteCatalogRefreshing)
            runCurrent()
            discovery.complete(listOf(node))
            advanceUntilIdle()
            assertTrue(vm.state.value.serviceRouteCatalog.routes.contains(node))
            assertFalse(vm.state.value.serviceRouteCatalogRefreshing)
            vm.checkServiceRoute(node, true)
            runCurrent()
            checked.await()
            vm.setServiceRoutePickerOpen(false)
            advanceUntilIdle()
            selection.complete(true)
            advanceUntilIdle()
            assertFalse(vm.state.value.serviceRoutePickerOpen)
            assertNull(vm.state.value.serviceRoutePending)
            assertEquals(ServiceRoute.Mainland.origin, prefs.serverUrl.value)
        } finally { container.close() }
    }
}
