package org.agent567.android.ui

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.agent567.android.app.AppContainer
import org.agent567.android.app.AppPreferences
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.auth.SettingsTokenStore
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.domain.session.MessageImage
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.agent567.android.ui.navigation.AppRoute
import org.agent567.android.ui.navigation.ChatSurface

/**
 * 驱动真实 [AppViewModel.openChat]：切换会话必须清空 pending 图片，防止串会话发送。
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModelSessionPendingTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun openChatClearsPendingImagesWhenSwitchingSessions() =
        runTest(dispatcher) {
            val container =
                AppContainer(
                    preferences = AppPreferences(MapSettings()),
                    tokenStore = InMemoryTokenStore(),
                    sessionStore = SettingsSessionStore(MapSettings(), dispatcher),
                )
            val vm = AppViewModel(container)
            advanceUntilIdle()
            assertTrue(vm.state.value.bootstrapped)

            val s1 = container.sessionStore.createSession(title = "one")
            val s2 = container.sessionStore.createSession(title = "two")
            vm.openChat(s1.id)
            advanceUntilIdle()
            assertEquals(s1.id, vm.state.value.currentSessionId)

            val img =
                MessageImage(
                    id = "p1",
                    mimeType = "image/png",
                    fileName = "x.png",
                    base64Data = "abc",
                )
            vm.addPendingImages(listOf(img))
            assertEquals(1, vm.state.value.pendingImages.size)

            vm.openChat(s2.id)
            advanceUntilIdle()
            assertEquals(s2.id, vm.state.value.currentSessionId)
            assertTrue(
                vm.state.value.pendingImages.isEmpty(),
                "pending images must not leak into another session",
            )
        }

    @Test
    fun openChatNullClearsPendingImages() =
        runTest(dispatcher) {
            val container =
                AppContainer(
                    preferences = AppPreferences(MapSettings()),
                    tokenStore = InMemoryTokenStore(),
                    sessionStore = SettingsSessionStore(MapSettings(), dispatcher),
                )
            val vm = AppViewModel(container)
            advanceUntilIdle()
            assertTrue(vm.state.value.bootstrapped)

            val s1 = container.sessionStore.createSession()
            vm.openChat(s1.id)
            advanceUntilIdle()
            assertEquals(s1.id, vm.state.value.currentSessionId)
            vm.addPendingImages(
                listOf(
                    MessageImage(id = "p2", mimeType = "image/jpeg", base64Data = "xyz"),
                ),
            )
            assertEquals(1, vm.state.value.pendingImages.size)

            vm.openChat(null)
            advanceUntilIdle()
            assertEquals(null, vm.state.value.currentSessionId)
            assertTrue(vm.state.value.pendingImages.isEmpty())
        }

    @Test
    fun clearLocalSessionsDeletesStoredSessionsAndCurrentState() =
        runTest(dispatcher) {
            val container =
                AppContainer(
                    preferences = AppPreferences(MapSettings()),
                    tokenStore = InMemoryTokenStore(),
                    sessionStore = SettingsSessionStore(MapSettings(), dispatcher),
                )
            val vm = AppViewModel(container)
            advanceUntilIdle()

            val session = container.sessionStore.createSession(title = "to clear")
            vm.openChat(session.id)
            advanceUntilIdle()
            vm.onDraftChange("本地草稿")
            vm.clearLocalSessions()
            advanceUntilIdle()

            assertTrue(container.sessionStore.sessions.value.isEmpty())
            assertEquals(null, vm.state.value.currentSessionId)
            assertEquals("", vm.state.value.draft)
        }

    @Test
    fun renameAndDeleteSessionPersistThroughViewModel() =
        runTest(dispatcher) {
            val container =
                AppContainer(
                    preferences = AppPreferences(MapSettings()),
                    tokenStore = InMemoryTokenStore(),
                    sessionStore = SettingsSessionStore(MapSettings(), dispatcher),
                )
            val vm = AppViewModel(container)
            advanceUntilIdle()

            val session = container.sessionStore.createSession(title = "旧标题")
            vm.renameSession(session.id, " 新标题 ")
            advanceUntilIdle()
            assertEquals("新标题", container.sessionStore.getSession(session.id)?.title)

            vm.deleteSession(session.id)
            advanceUntilIdle()
            assertEquals(null, container.sessionStore.getSession(session.id))
        }

    @Test
    fun bootstrapWithPersistedTokenPreservesLoggedInWorkspace() =
        runTest(dispatcher) {
            val settings = MapSettings()
            val preferences = AppPreferences(settings)
            val tokenStore = org.agent567.android.core.auth.SettingsTokenStore(settings)
            tokenStore.save("test_token_persisted", "test_token_persisted")
            preferences.authUsername = "persisted_user"
            preferences.authQuotaUsd = 12.5

            val container =
                AppContainer(
                    preferences = preferences,
                    tokenStore = tokenStore,
                    sessionStore = SettingsSessionStore(settings, dispatcher),
                )
            val vm = AppViewModel(container)
            advanceUntilIdle()

            assertTrue(vm.state.value.bootstrapped)
            assertTrue(vm.state.value.mainAccessGranted)
            assertTrue(vm.state.value.route is org.agent567.android.ui.navigation.AppRoute.Main)
            assertEquals("persisted_user", vm.state.value.user?.nickname)
            assertEquals(12.5, vm.state.value.user?.quotaUsd)
        }

    @Test
    fun bootstrapRestoresLastSessionRouteOnlyWhenPreferenceIsEnabled() =
        runTest(dispatcher) {
            val settings = MapSettings()
            val preferences = AppPreferences(settings)
            preferences.setAutoResumeLastSession(true)
            val tokenStore = SettingsTokenStore(settings)
            tokenStore.save("restore_test_token", "restore_test_token")
            val sessionStore = SettingsSessionStore(settings, dispatcher)
            val session = sessionStore.createSession(title = "Resume me")
            preferences.lastSessionId = session.id

            val vm = AppViewModel(
                AppContainer(
                    preferences = preferences,
                    tokenStore = tokenStore,
                    sessionStore = sessionStore,
                ),
            )
            advanceUntilIdle()

            assertEquals(AppRoute.Chat(session.id, ChatSurface.Cloud, "Resume me"), vm.state.value.route)
            assertEquals(session.id, vm.state.value.currentSessionId)
        }
    @Test
    fun restoresDraftAndAttachmentsAfterRecreationWithoutLeakingBetweenSessions() = runTest(dispatcher) {
        val settings = MapSettings()
        val preferences = AppPreferences(settings)
        val files = object : org.agent567.android.domain.session.MessageImageFileStore {
            val data = mutableMapOf<String, ByteArray>()
            override fun writeBytes(key: String, bytes: ByteArray): Boolean { data[key] = bytes.copyOf(); return true }
            override fun writeBase64(key: String, base64Data: String): Boolean = false
            override fun readBytes(key: String): ByteArray? = data[key]?.copyOf()
            override fun delete(key: String) { data.remove(key) }
        }
        val store = SettingsSessionStore(settings, dispatcher, files)
        val a = store.createSession(title = "A")
        val b = store.createSession(title = "B")
        val vm = AppViewModel(AppContainer(preferences = preferences, tokenStore = InMemoryTokenStore(), sessionStore = store))
        advanceUntilIdle()
        preferences.authUserId = 7
        vm.openChat(a.id)
        vm.onDraftChange("survive process restart")
        vm.addPendingImages(listOf(MessageImage("img", "image/png", pendingBytes = byteArrayOf(1, 2, 3))))
        vm.addPendingDocument(org.agent567.android.domain.session.PendingFileAttachment("file", "notes.txt", "text/plain", byteArrayOf(4, 5)))
        advanceUntilIdle()
        vm.openChat(b.id)
        advanceUntilIdle()
        assertEquals("", vm.state.value.draft)
        assertTrue(vm.state.value.pendingImages.isEmpty())
        vm.onDraftChange("B draft")
        advanceUntilIdle()
        val reopened = AppViewModel(AppContainer(preferences = preferences, tokenStore = InMemoryTokenStore(), sessionStore = SettingsSessionStore(settings, dispatcher, files)))
        advanceUntilIdle()
        preferences.authUserId = 7
        reopened.openChat(a.id)
        advanceUntilIdle()
        assertEquals("survive process restart", reopened.state.value.draft)
        assertTrue(reopened.state.value.pendingImages.single().pendingBytes!!.contentEquals(byteArrayOf(1, 2, 3)))
        assertTrue(reopened.state.value.pendingFiles.single().bytes.contentEquals(byteArrayOf(4, 5)))
        reopened.openChat(b.id)
        reopened.onDraftChange("new typing wins over late restore")
        advanceUntilIdle()
        assertEquals("new typing wins over late restore", reopened.state.value.draft)
    }
    @Test
    fun switchingSessionNeverDisplaysThePreviousSessionsReply() = runTest(dispatcher) {
        val store = SettingsSessionStore(MapSettings(), dispatcher)
        val a = store.createSession(title = "A")
        val b = store.createSession(title = "B")
        store.upsertMessage(org.agent567.android.domain.session.LocalMessage("reply-a", a.id, org.agent567.android.core.model.ChatRole.Assistant, "Reply A", org.agent567.android.domain.session.MessageStatus.Complete, 1))
        val vm = AppViewModel(AppContainer(preferences = AppPreferences(MapSettings()), tokenStore = InMemoryTokenStore(), sessionStore = store))
        advanceUntilIdle()
        vm.openChat(a.id)
        advanceUntilIdle()
        assertEquals("Reply A", vm.state.value.messages.single().content)
        vm.openChat(b.id)
        assertTrue(vm.state.value.messages.none { it.sessionId != b.id })
        advanceUntilIdle()
        assertTrue(vm.state.value.messages.isEmpty())
    }

}
