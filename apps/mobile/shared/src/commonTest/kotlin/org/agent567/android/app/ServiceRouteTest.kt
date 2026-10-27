package org.agent567.android.app

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.agent567.android.core.ServiceRoute
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.net.NetworkAvailability
import org.agent567.android.data.session.SettingsSessionStore
import kotlin.test.*

class ServiceRouteTest {
    @Test fun newInstallAndImplicitUpgradeDefaultToGermanyWhileSavedRoutesRemainUnchanged() {
        val fresh = MapSettings()
        assertEquals(ServiceRoute.Germany.origin, AppPreferences(fresh).serverUrl.value)
        assertEquals(ServiceRoute.Germany.origin, AppPreferences(fresh).serverUrl.value)
        val legacy = MapSettings().apply { putString("vetta.prefs.theme", "Dark") }
        assertEquals(ServiceRoute.Germany.origin, AppPreferences(legacy).serverUrl.value)
        val mainland = MapSettings().apply { putString("vetta.prefs.server_url", ServiceRoute.Mainland.origin) }
        assertEquals(ServiceRoute.Mainland.origin, AppPreferences(mainland).serverUrl.value)
        val custom = MapSettings().apply { putString("vetta.prefs.server_url", "https://private.test/api/v1") }
        assertEquals("https://private.test/api/v1", AppPreferences(custom).serverUrl.value)
    }
    @Test fun migratesOnlyTheOldAutomaticMainlandAndPreservesSubsequentUserSelection() {
        val settings = MapSettings().apply { putString("agent567.prefs.server_url", ServiceRoute.Mainland.origin) }
        val upgraded = AppPreferences(settings)
        assertEquals(ServiceRoute.Germany.origin, upgraded.serverUrl.value)
        assertEquals(ServiceRoute.Germany.origin, AppPreferences(settings).serverUrl.value)
        upgraded.setServerUrl(ServiceRoute.Mainland.origin)
        assertEquals(ServiceRoute.Mainland.origin, AppPreferences(settings).serverUrl.value)
        upgraded.setServerUrl("https://private.test/api/v1")
        assertEquals("https://private.test/api/v1", AppPreferences(settings).serverUrl.value)
    }
    @Test fun preservesRecordedAndLegacyMainlandChoicesIncludingAmbiguousRecords() {
        for (known in listOf("[]", "[\"https://a.567.wiki\"]", "invalid-legacy-record")) {
            val settings = MapSettings().apply {
                putString("agent567.prefs.server_url", ServiceRoute.Mainland.origin)
                putString("567agent.service-routes.known.v1", known)
            }
            assertEquals(ServiceRoute.Mainland.origin, AppPreferences(settings).serverUrl.value)
            assertEquals(ServiceRoute.Mainland.origin, AppPreferences(settings).serverUrl.value)
        }
        val legacy = MapSettings().apply { putString("vetta.prefs.server_url", ServiceRoute.Mainland.origin) }
        repeat(2) { assertEquals(ServiceRoute.Mainland.origin, AppPreferences(legacy).serverUrl.value) }
    }
    @Test fun exactOriginsShareCapacityWhileCustomServicesRemainSeparate() {
        val settings = MapSettings().apply {
            putString("vetta.prefs.server_url", "https://api.567.wiki/api/v1")
            putString("567agent.model-context.v1.[\"https://api.567.wiki/api/v1\",\"B\",\"override\",\"model\"]", "64000")
        }
        val prefs = AppPreferences(settings)
        assertEquals(64000L, prefs.getModelContextOverride("B", "model"))
        prefs.setServerUrl(ServiceRoute.Mainland.origin)
        assertEquals(64000L, prefs.getModelContextOverride("B", "model"))
        prefs.setModelContextOverride("B", "model", null)
        prefs.setServerUrl(ServiceRoute.Germany.origin)
        assertNull(prefs.getModelContextOverride("B", "model"))
        prefs.setModelContextOverride("B", "model", 128000)
        prefs.setServerUrl("https://private.test")
        assertNull(prefs.getModelContextOverride("B", "model"))
        listOf("https://api.567.wiki.evil", "http://api.567.wiki", "https://user@a.567.wiki", "https://a.567.wiki/custom", "https://a.567.wiki:444", "https://a.567.wiki?token=x").forEach { assertNull(ServiceRoute.fromServer(it), it) }
    }
    @Test fun switchValidatesWithoutLosingLoginAndKeepsExistingClientForRunningRequests() = runTest {
        val settings = MapSettings().apply { putString("vetta.prefs.server_url", ServiceRoute.Germany.origin + "/api/v1") }
        val prefs = AppPreferences(settings)
        prefs.setModelContextOverride("B", "model", 128000)
        val tokens = InMemoryTokenStore("account-token", "session=shared")
        val checks = mutableListOf<Pair<ServiceRoute, String?>>()
        val container = AppContainer(preferences = prefs, tokenStore = tokens, sessionStore = SettingsSessionStore(MapSettings()), networkAvailability = MutableStateFlow(NetworkAvailability.Available), checkServiceRoute = { route, token -> checks.add(route to token); true })
        try {
            val runningClient = container.client
            assertTrue(container.selectServiceRoute(ServiceRoute.Mainland).ok)
            assertEquals(listOf(ServiceRoute.Mainland to null, ServiceRoute.Mainland to "account-token"), checks)
            assertEquals(ServiceRoute.Germany.origin, runningClient.config.apiBaseUrl)
            assertEquals(ServiceRoute.Mainland.origin, container.client.config.apiBaseUrl)
            assertNotSame(runningClient, container.client)
            assertEquals("account-token", tokens.accessToken)
            assertEquals(128000L, prefs.getModelContextOverride("B", "model"))
            assertEquals(ServiceRoute.Mainland.origin, AppPreferences(settings).serverUrl.value)
            assertTrue(container.selectServiceRoute(ServiceRoute.Germany).ok)
            assertSame(runningClient, container.client)
        } finally { container.close() }
    }
    @Test fun rejectedAccountAndCancelledProbeKeepOriginalConfiguration() = runTest {
        val prefs = AppPreferences(MapSettings())
        val tokens = InMemoryTokenStore("account-token", "session=shared")
        var reject = true
        val entered = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Boolean>()
        val container = AppContainer(preferences = prefs, tokenStore = tokens, sessionStore = SettingsSessionStore(MapSettings()), networkAvailability = MutableStateFlow(NetworkAvailability.Available), checkServiceRoute = { _, token -> if (reject) token == null else { entered.complete(Unit); release.await() } })
        try {
            val client = container.client
            assertEquals("account-rejected", container.selectServiceRoute(ServiceRoute.Mainland).error)
            assertSame(client, container.client)
            assertEquals("account-token", tokens.accessToken)
            reject = false
            val pending = async { container.selectServiceRoute(ServiceRoute.Mainland) }
            entered.await(); pending.cancelAndJoin()
            assertSame(client, container.client)
            assertEquals(ServiceRoute.Germany.origin, prefs.serverUrl.value)
        } finally { container.close() }
    }
    @Test fun neverSendsCustomServerCredentialsToBuiltInRoutes() = runTest {
        val prefs = AppPreferences(MapSettings().apply { putString("vetta.prefs.server_url", "https://private.test") })
        val tokens = InMemoryTokenStore("private-token", "private-refresh")
        val container = AppContainer(preferences = prefs, tokenStore = tokens, sessionStore = SettingsSessionStore(MapSettings()), networkAvailability = MutableStateFlow(NetworkAvailability.Available), checkServiceRoute = { _, _ -> fail("Must not check with custom credentials") })
        try {
            assertEquals("custom-server", container.selectServiceRoute(ServiceRoute.Germany).error)
            assertEquals("https://private.test", prefs.serverUrl.value)
            assertEquals("private-token", tokens.accessToken)
        } finally { container.close() }
    }
}
