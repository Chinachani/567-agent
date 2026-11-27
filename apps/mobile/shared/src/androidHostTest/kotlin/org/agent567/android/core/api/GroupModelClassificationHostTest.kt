package org.agent567.android.core.api

import androidx.lifecycle.viewModelScope
import com.russhwolf.settings.MapSettings
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import org.agent567.android.app.AppContainer
import org.agent567.android.app.AppPreferences
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.net.NetworkAvailability
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.ui.AppViewModel
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class GroupModelClassificationHostTest {
    @Test
    fun sharedGroupFiltersConversationOnStartupAndRefreshWhileKeepingManualImageSelection() =
        Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { dispatcher ->
            runBlocking(dispatcher) {
                val imageOnly = listOf("nano-banana-2.1", "seedream-v5.5")
                val dual = "gemini-2.5-flash-image"
                val vision = "qwen-vl-max"
                val manual = "custom-renderer"
                val cachedIds = imageOnly + listOf(vision, dual, manual)
                val freshIds = cachedIds + "new-chat-model"
                val allowRefresh = CountDownLatch(1)
                val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
                server.createContext("/") { request ->
                    val body = when (request.requestURI.path) {
                        "/api/user/groups" -> {
                            check(allowRefresh.await(15, TimeUnit.SECONDS))
                            """{"success":true,"data":{"shared":{},"drawing":{}}}"""
                        }
                        "/api/user/models" -> {
                            val ids = if (request.requestURI.query == "group=drawing") imageOnly else freshIds
                            """{"success":true,"data":${JsonArray(ids.map(::JsonPrimitive))}}"""
                        }
                        "/api/user/self" -> """{"success":true,"data":{"id":7,"username":"test","quota":500000,"group":"shared"}}"""
                        "/v1/models" -> """{"data":[]}"""
                        else -> """{"success":true,"data":{}}"""
                    }.toByteArray()
                    request.responseHeaders.add("Content-Type", "application/json")
                    request.sendResponseHeaders(200, body.size.toLong())
                    request.responseBody.use { it.write(body) }
                }
                server.start()
                val preferences = AppPreferences(MapSettings()).apply {
                    setServerUrl("http://127.0.0.1:${server.address.port}")
                    active567Group = "shared"
                    activeImageGroup = "shared"
                    lastModelId = imageOnly.first()
                    setCachedGroupModels("shared", cachedIds)
                }
                val container = AppContainer(
                    preferences,
                    InMemoryTokenStore("sk-local-fixture", "sk-local-fixture"),
                    SettingsSessionStore(MapSettings(), Dispatchers.IO),
                    networkAvailability = MutableStateFlow(NetworkAvailability.Available),
                    loadServiceRoutes = { emptyList() },
                )
                Dispatchers.setMain(dispatcher)
                val viewModel = AppViewModel(container)
                try {
                    val cached = withTimeout(15_000) { viewModel.state.first { it.bootstrapped } }
                    assertEquals(listOf(vision, dual, manual), cached.models.map { it.id })
                    assertEquals(dual, cached.selectedModelId)
                    assertEquals(imageOnly + dual, cached.availableImageModels)
                    assertEquals(cachedIds, cached.imageGroupModelIds)
                    viewModel.setActiveImageModel(manual)
                    assertEquals(manual, viewModel.state.value.activeImageModel)

                    allowRefresh.countDown()
                    val refreshed = withTimeout(15_000) {
                        viewModel.state.first { !it.catalogLoading && !it.imageModelsLoading }
                    }
                    assertEquals(listOf(vision, dual, manual, "new-chat-model"), refreshed.models.map { it.id })
                    assertEquals(dual, preferences.lastModelId)
                    assertEquals(imageOnly + dual, refreshed.availableImageModels)
                    assertEquals(freshIds, refreshed.imageGroupModelIds)
                    assertEquals(freshIds, preferences.getCachedGroupModels("shared"))
                    assertEquals(manual, refreshed.activeImageModel)

                    viewModel.setActive567Group("drawing")
                    val drawingChat = withTimeout(15_000) {
                        viewModel.state.first { it.active567Group == "drawing" && !it.catalogLoading && !it.imageModelsLoading }
                    }
                    assertTrue(drawingChat.models.isEmpty())
                    assertNull(drawingChat.selectedModelId)
                    assertEquals(imageOnly, preferences.getCachedGroupModels("drawing"))
                    assertEquals(manual, drawingChat.activeImageModel)
                } finally {
                    allowRefresh.countDown()
                    viewModel.viewModelScope.coroutineContext.job.cancelAndJoin()
                    Dispatchers.resetMain()
                    container.close()
                    server.stop(0)
                }
            }
        }
}
