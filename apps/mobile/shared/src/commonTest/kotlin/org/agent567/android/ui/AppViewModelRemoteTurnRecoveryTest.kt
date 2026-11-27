package org.agent567.android.ui

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.agent567.android.app.AppContainer
import org.agent567.android.app.AppPreferences
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.core.model.LlmModel
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.domain.conversation.RemoteConversationException
import org.agent567.android.domain.conversation.RemoteConversationGateway
import org.agent567.android.domain.conversation.RemoteDesktopHistoryMessage
import org.agent567.android.domain.conversation.RemoteDesktopSessionSummary
import org.agent567.android.domain.conversation.RemotePromptFileAttachment
import org.agent567.android.domain.conversation.RemoteSessionModelCatalog
import org.agent567.android.domain.conversation.RemoteTurnNotFoundException
import org.agent567.android.domain.device.ConnectChannel
import org.agent567.android.domain.device.DesktopDevice
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.domain.error.UiErrorAction
import org.agent567.android.domain.session.ConversationOrigin
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.domain.session.PendingRemoteTurn
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.navigation.ChatSurface
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModelRemoteTurnRecoveryTest {
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
    fun completedRecoveryPersistsFinalMessageEvenAfterRestartReconcilesRowAsAborted() =
        runTest(dispatcher) {
            val settings = MapSettings()
            val initialStore = SettingsSessionStore(settings, dispatcher)
            val session = initialStore.createSession(
                title = "重启续接",
                origin = ConversationOrigin.Desktop,
                remoteDeviceId = "desktop-1",
                remoteSessionId = "remote-1",
            )
            val pending = PendingRemoteTurn("turn-complete", "desktop-1", "remote-1", "a1", 2L)
            initialStore.updateSession(session.copy(pendingRemoteTurn = pending))
            initialStore.upsertMessage(LocalMessage("u1", session.id, ChatRole.User, "继续构建", MessageStatus.Complete, 1L))
            initialStore.upsertMessage(LocalMessage("a1", session.id, ChatRole.Assistant, "", MessageStatus.Streaming, 2L))

            // Recreate store to mimic process restart where Streaming rows reconcile to Aborted.
            val restartedStore = SettingsSessionStore(settings, dispatcher)
            assertEquals(MessageStatus.Aborted, restartedStore.getMessages(session.id).last().status)

            val gateway = RecoveryGateway().apply {
                recoverHandler = {
                    listOf(
                        ChatStreamEvent.Snapshot(
                            text = "已全部恢复完毕",
                            tools = emptyList(),
                            input = null,
                            state = "completed",
                            usage = null,
                        ),
                        ChatStreamEvent.State("completed"),
                        ChatStreamEvent.Done,
                    )
                }
            }
            val vm = AppViewModel(container(settings, restartedStore, gateway))
            advanceUntilIdle()
            vm.openChat(session.id, ChatSurface.Desktop, session.title, "desktop-1")
            advanceUntilIdle()

            val diskStore = SettingsSessionStore(settings, dispatcher)
            val recoveredMsg = diskStore.getMessages(session.id).single { it.id == "a1" }
            assertEquals(MessageStatus.Complete, recoveredMsg.status)
            assertEquals("已全部恢复完毕", recoveredMsg.content)
            assertNull(diskStore.getSession(session.id)?.pendingRemoteTurn)
            assertTrue(gateway.streamCalls.isEmpty())
        }

    @Test
    fun desktopExecutionErrorDuringRecoveryClearsPendingTurnWithoutShowingUnconfirmedError() =
        runTest(dispatcher) {
            val settings = MapSettings()
            val store = SettingsSessionStore(settings, dispatcher)
            val session = store.createSession(
                title = "桌面报错",
                origin = ConversationOrigin.Desktop,
                remoteDeviceId = "desktop-1",
                remoteSessionId = "remote-1",
            )
            store.updateSession(
                session.copy(pendingRemoteTurn = PendingRemoteTurn("turn-err", "desktop-1", "remote-1", "a1", 2L)),
            )
            store.upsertMessage(LocalMessage("u1", session.id, ChatRole.User, "运行测试", MessageStatus.Complete, 1L))
            store.upsertMessage(LocalMessage("a1", session.id, ChatRole.Assistant, "", MessageStatus.Aborted, 2L))

            val gateway = RecoveryGateway().apply {
                recoverHandler = {
                    listOf(
                        ChatStreamEvent.Snapshot("部分输出", emptyList(), null, "error", null),
                        ChatStreamEvent.State("error", detail = "模型配额不足"),
                    )
                }
            }
            val vm = AppViewModel(container(settings, store, gateway))
            advanceUntilIdle()
            vm.openChat(session.id, ChatSurface.Desktop, session.title, "desktop-1")
            advanceUntilIdle()

            assertNull(store.getSession(session.id)?.pendingRemoteTurn)
            assertEquals("桌面执行失败", vm.state.value.chatError?.title)
            assertEquals(UiErrorAction.Retry, vm.state.value.chatError?.action)
            assertEquals(MessageStatus.Error, store.getMessages(session.id).single { it.id == "a1" }.status)
        }

    @Test
    fun unreceivedTurnOffersResendReusingTurnIdWithoutOverwritingPriorTurn() =
        runTest(dispatcher) {
            val settings = MapSettings()
            val store = SettingsSessionStore(settings, dispatcher)
            val other = store.createSession(title = "other")
            val session = store.createSession(
                title = "未送达会话",
                origin = ConversationOrigin.Desktop,
                remoteDeviceId = "desktop-1",
                remoteSessionId = "remote-1",
            )
            store.upsertMessage(LocalMessage("u1", session.id, ChatRole.User, "第一条成功", MessageStatus.Complete, 1L))
            store.upsertMessage(LocalMessage("a1", session.id, ChatRole.Assistant, "第一条回答", MessageStatus.Complete, 2L))
            store.upsertMessage(LocalMessage("u2", session.id, ChatRole.User, "第二条未达", MessageStatus.Complete, 3L))
            store.upsertMessage(LocalMessage("a2", session.id, ChatRole.Assistant, "", MessageStatus.Aborted, 4L))
            store.updateSession(
                session.copy(
                    pendingRemoteTurn = PendingRemoteTurn(
                        turnId = "turn-2",
                        deviceId = "desktop-1",
                        remoteSessionId = "remote-1",
                        assistantMessageId = "a2",
                        createdAtEpochMs = 4L,
                        retryPreviousTurn = false,
                    ),
                ),
            )

            val gateway = RecoveryGateway().apply {
                recoverError = RemoteTurnNotFoundException("未找到")
            }
            val vm = AppViewModel(container(settings, store, gateway))
            advanceUntilIdle()
            vm.openChat(session.id, ChatSurface.Desktop, session.title, "desktop-1")
            advanceUntilIdle()

            assertEquals(1, gateway.recoverCalls.size)
            assertEquals(Str.remoteTurnUnconfirmedTitle, vm.state.value.chatError?.title)
            assertEquals(UiErrorAction.ResendRemoteTurn, vm.state.value.chatError?.action)
            assertTrue(store.getSession(session.id)?.pendingRemoteTurn?.confirmedNotReceived == true)

            // Reopening after switching sessions surfaces ResendRemoteTurn immediately without extra polling.
            vm.openChat(other.id)
            advanceUntilIdle()
            vm.openChat(session.id, ChatSurface.Desktop, session.title, "desktop-1")
            advanceUntilIdle()
            assertEquals(1, gateway.recoverCalls.size)
            assertEquals(UiErrorAction.ResendRemoteTurn, vm.state.value.chatError?.action)

            gateway.streamHandler = {
                listOf(ChatStreamEvent.Delta("重发成功"), ChatStreamEvent.Done)
            }
            vm.handleErrorAction(UiErrorAction.ResendRemoteTurn)
            advanceUntilIdle()

            val resentCall = gateway.streamCalls.single()
            assertEquals("turn-2", resentCall.remoteTurnId)
            assertFalse(resentCall.retryPreviousTurn, "Unreceived normal send must not replace prior completed turn")
            assertEquals("第二条未达", resentCall.promptText)
            assertNull(store.getSession(session.id)?.pendingRemoteTurn)
            assertEquals(MessageStatus.Complete, vm.state.value.messages.last().status)
        }

    @Test
    fun transientRecoveryFailureAutoResumesWhenDeviceReconnectsAndFallsBackInOneTap() =
        runTest(dispatcher) {
            val settings = MapSettings()
            val store = SettingsSessionStore(settings, dispatcher)
            val session = store.createSession(
                title = "重连恢复",
                origin = ConversationOrigin.Desktop,
                remoteDeviceId = "desktop-1",
                remoteSessionId = "remote-1",
            )
            store.upsertMessage(LocalMessage("u1", session.id, ChatRole.User, "执行重连", MessageStatus.Complete, 1L))
            store.upsertMessage(LocalMessage("a1", session.id, ChatRole.Assistant, "", MessageStatus.Aborted, 2L))
            store.updateSession(
                session.copy(pendingRemoteTurn = PendingRemoteTurn("turn-net", "desktop-1", "remote-1", "a1", 2L)),
            )

            val gateway = RecoveryGateway().apply {
                devices.value = listOf(DesktopDevice("desktop-1", "Desk", "Linux", "host", DeviceStatus.Offline, ConnectChannel.Lan))
                recoverError = RemoteConversationException("等待桌面连接超时")
            }
            val vm = AppViewModel(container(settings, store, gateway))
            advanceUntilIdle()
            vm.openChat(session.id, ChatSurface.Desktop, session.title, "desktop-1")
            advanceUntilIdle()

            assertEquals(UiErrorAction.ResumeRemoteTurn, vm.state.value.chatError?.action)
            assertFalse(store.getSession(session.id)?.pendingRemoteTurn?.confirmedNotReceived ?: true)

            // Reconnect resumes automatically without manual resend.
            gateway.recoverError = null
            gateway.recoverHandler = {
                listOf(
                    ChatStreamEvent.Snapshot("断线后继续完成", emptyList(), null, "completed", null),
                    ChatStreamEvent.State("completed"),
                    ChatStreamEvent.Done,
                )
            }
            gateway.devices.value = listOf(DesktopDevice("desktop-1", "Desk", "Linux", "host", DeviceStatus.Online, ConnectChannel.Lan))
            advanceUntilIdle()

            assertNull(store.getSession(session.id)?.pendingRemoteTurn)
            assertEquals("断线后继续完成", store.getMessages(session.id).single { it.id == "a1" }.content)

            // Second turn fails recovery transiently, then user clicks ResumeRemoteTurn -> NotFound -> 1-tap resend!
            store.upsertMessage(LocalMessage("u2", session.id, ChatRole.User, "一键重发", MessageStatus.Complete, 3L))
            store.upsertMessage(LocalMessage("a2", session.id, ChatRole.Assistant, "", MessageStatus.Aborted, 4L))
            store.updateSession(
                session.copy(pendingRemoteTurn = PendingRemoteTurn("turn-onetap", "desktop-1", "remote-1", "a2", 4L)),
            )
            gateway.recoverHandler = { emptyList() }
            gateway.recoverError = RemoteConversationException("临时超时")
            vm.openChat(session.id, ChatSurface.Desktop, session.title, "desktop-1")
            advanceUntilIdle()
            assertEquals(UiErrorAction.ResumeRemoteTurn, vm.state.value.chatError?.action)

            gateway.recoverError = RemoteTurnNotFoundException("未找到")
            gateway.streamHandler = { listOf(ChatStreamEvent.Delta("一键重发完成"), ChatStreamEvent.Done) }
            vm.handleErrorAction(UiErrorAction.ResumeRemoteTurn)
            advanceUntilIdle()

            assertEquals("turn-onetap", gateway.streamCalls.single().remoteTurnId)
            assertFalse(gateway.streamCalls.single().retryPreviousTurn)
            assertNull(store.getSession(session.id)?.pendingRemoteTurn)
        }

    @Test
    fun mobileCreatedDesktopSessionPersistsResolvedRemoteIdBeforeFailureAndRecovers() =
        runTest(dispatcher) {
            val settings = MapSettings()
            val store = SettingsSessionStore(settings, dispatcher)
            val session = store.createSession(
                title = "新会话",
                origin = ConversationOrigin.Desktop,
                remoteDeviceId = "desktop-1",
                remoteSessionId = null,
                remoteSessionCreatedOnMobile = true,
            )
            val gateway = RecoveryGateway().apply {
                resolvedRemoteId = "remote-created-1"
                streamHandler = { throw RemoteConversationException("网络中断") }
                // Ensure resolved id is exposed during stream emission by emitting one delta first
                streamHandlerWithEmit = { emit ->
                    emit(ChatStreamEvent.Delta("前半段"))
                    throw RemoteConversationException("网络中断")
                }
            }
            val vm = AppViewModel(container(settings, store, gateway))
            advanceUntilIdle()
            vm.openChat(session.id, ChatSurface.Desktop, session.title, "desktop-1")
            advanceUntilIdle()

            vm.onDraftChange("新建任务")
            vm.sendMessage()
            advanceUntilIdle()

            val saved = store.getSession(session.id)
            assertNotNull(saved?.pendingRemoteTurn)
            assertEquals("remote-created-1", saved.remoteSessionId)
            assertEquals("remote-created-1", saved.pendingRemoteTurn.remoteSessionId)
            assertEquals(UiErrorAction.ResumeRemoteTurn, vm.state.value.chatError?.action)

            // Restart and verify recovery runs against resolved remoteSessionId using original turnId.
            val turnId = saved.pendingRemoteTurn.turnId
            val reloadedBeforeRestart = SettingsSessionStore(settings, dispatcher).getSession(session.id)?.pendingRemoteTurn
            assertEquals(false, reloadedBeforeRestart?.retryPreviousTurn)
            assertEquals(false, reloadedBeforeRestart?.confirmedNotReceived)
            gateway.recoverHandler = {
                listOf(
                    ChatStreamEvent.Snapshot("完整恢复结果", emptyList(), null, "completed", null),
                    ChatStreamEvent.Done,
                )
            }
            val restartedStore = SettingsSessionStore(settings, dispatcher)
            val vm2 = AppViewModel(container(settings, restartedStore, gateway))
            advanceUntilIdle()
            vm2.openChat(session.id, ChatSurface.Desktop, session.title, "desktop-1")
            advanceUntilIdle()

            assertEquals("remote-created-1", gateway.recoverCalls.single().remoteSessionId)
            assertEquals(turnId, gateway.recoverCalls.single().turnId)
            assertNull(restartedStore.getSession(session.id)?.pendingRemoteTurn)
        }

    @Test
    fun stopStreamingCancelsActiveRecoveryAndLivePendingTurn() =
        runTest(dispatcher) {
            val settings = MapSettings()
            val store = SettingsSessionStore(settings, dispatcher)
            val session = store.createSession(
                title = "停止恢复",
                origin = ConversationOrigin.Desktop,
                remoteDeviceId = "desktop-1",
                remoteSessionId = "remote-1",
            )
            store.upsertMessage(LocalMessage("u1", session.id, ChatRole.User, "跑长任务", MessageStatus.Complete, 1L))
            store.upsertMessage(LocalMessage("a1", session.id, ChatRole.Assistant, "", MessageStatus.Aborted, 2L))
            store.updateSession(
                session.copy(pendingRemoteTurn = PendingRemoteTurn("turn-stop", "desktop-1", "remote-1", "a1", 2L)),
            )

            val gate = CompletableDeferred<Unit>()
            val gateway = RecoveryGateway().apply {
                recoverWait = gate
            }
            val vm = AppViewModel(container(settings, store, gateway))
            advanceUntilIdle()
            vm.openChat(session.id, ChatSurface.Desktop, session.title, "desktop-1")
            runCurrent()
            assertTrue(vm.state.value.isStreaming)

            vm.stopStreaming()
            advanceUntilIdle()

            assertFalse(vm.state.value.isStreaming)
            assertNull(store.getSession(session.id)?.pendingRemoteTurn)
            assertEquals(listOf("desktop-1"), gateway.aborted)
        }

    private fun container(
        settings: MapSettings,
        store: SettingsSessionStore,
        gateway: RecoveryGateway,
    ): AppContainer =
        AppContainer(
            preferences = AppPreferences(settings),
            tokenStore = InMemoryTokenStore(),
            sessionStore = store,
            remoteConversationGateway = gateway,
        )
}

private data class RecordedStreamCall(
    val remoteSessionId: String?,
    val retryPreviousTurn: Boolean,
    val promptText: String,
    val remoteTurnId: String?,
)

private data class RecordedRecoverCall(
    val deviceId: String,
    val remoteSessionId: String,
    val turnId: String,
)

private class RecoveryGateway : RemoteConversationGateway {
    override val devices = MutableStateFlow(
        listOf(DesktopDevice("desktop-1", "Desk", "Linux", "host", DeviceStatus.Online, ConnectChannel.Lan)),
    )
    var resolvedRemoteId: String? = "remote-1"
    var recoverError: Throwable? = null
    var recoverWait: CompletableDeferred<Unit>? = null
    var recoverHandler: (() -> List<ChatStreamEvent>)? = null
    var streamHandler: (() -> List<ChatStreamEvent>)? = null
    var streamHandlerWithEmit: (suspend (suspend (ChatStreamEvent) -> Unit) -> Unit)? = null
    val streamCalls = mutableListOf<RecordedStreamCall>()
    val recoverCalls = mutableListOf<RecordedRecoverCall>()
    val aborted = mutableListOf<String>()

    override suspend fun connect(target: String): Boolean = true
    override suspend fun disconnect(deviceId: String) = Unit
    override suspend fun listDesktopSessions(deviceId: String): List<RemoteDesktopSessionSummary> = emptyList()
    override suspend fun deleteEmptyDesktopSession(deviceId: String, remoteSessionId: String): Boolean = true
    override suspend fun deleteDesktopSession(deviceId: String, remoteSessionId: String): Boolean = true
    override suspend fun createDesktopSession(localSessionId: String, deviceId: String): Pair<String, RemoteSessionModelCatalog> =
        (resolvedRemoteId ?: "remote-1") to RemoteSessionModelCatalog(
            currentModelId = null,
            models = listOf(LlmModel(id = "p/m", modelId = "m", name = "M", providerName = "P")),
        )
    override suspend fun readDesktopSessionHistory(localSessionId: String, remoteSessionId: String): List<RemoteDesktopHistoryMessage> =
        emptyList()

    override fun stream(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
        retryPreviousTurn: Boolean,
    ): Flow<ChatStreamEvent> = streamWithAttachments(
        localSessionId = localSessionId,
        deviceId = deviceId,
        remoteSessionId = remoteSessionId,
        messages = messages,
        retryPreviousTurn = retryPreviousTurn,
        promptText = messages.lastOrNull()?.textContent.orEmpty(),
        files = emptyList(),
        remoteTurnId = null,
    )

    override fun streamWithAttachments(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        messages: List<ChatMessage>,
        retryPreviousTurn: Boolean,
        promptText: String,
        files: List<RemotePromptFileAttachment>,
        remoteTurnId: String?,
    ): Flow<ChatStreamEvent> = flow {
        streamCalls += RecordedStreamCall(remoteSessionId, retryPreviousTurn, promptText, remoteTurnId)
        val emitFn = streamHandlerWithEmit
        if (emitFn != null) {
            emitFn { event -> emit(event) }
        } else {
            streamHandler?.invoke()?.forEach { emit(it) }
        }
    }

    override fun resolvedRemoteSessionId(localSessionId: String): String? = resolvedRemoteId

    override fun recoverRemoteTurn(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String,
        turnId: String,
    ): Flow<ChatStreamEvent> = flow {
        recoverCalls += RecordedRecoverCall(deviceId, remoteSessionId, turnId)
        recoverWait?.await()
        recoverError?.let { throw it }
        recoverHandler?.invoke()?.forEach { emit(it) }
    }

    override suspend fun abort(localSessionId: String, deviceId: String, remoteSessionId: String?) {
        aborted += deviceId
    }

    override suspend fun respond(
        localSessionId: String,
        deviceId: String,
        remoteSessionId: String?,
        requestId: String,
        answers: List<Pair<String, List<String>>>,
        cancelled: Boolean,
    ) = Unit
}
