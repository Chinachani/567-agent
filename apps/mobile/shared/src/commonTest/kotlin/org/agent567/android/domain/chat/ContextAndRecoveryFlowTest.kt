package org.agent567.android.domain.chat

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.json.*
import org.agent567.android.app.*
import org.agent567.android.core.auth.InMemoryTokenStore
import org.agent567.android.core.model.*
import org.agent567.android.core.net.NetworkAvailability
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.domain.chat.*
import org.agent567.android.domain.conversation.RelayRemoteConversationGateway
import org.agent567.android.domain.remote.connection.RemoteTransport
import org.agent567.android.domain.remote.protocol.*
import org.agent567.android.domain.session.*
import org.agent567.android.ui.AppViewModel
import org.agent567.android.ui.navigation.ChatSurface
import kotlin.coroutines.CoroutineContext
import kotlin.test.*

/** Public VM/store/transport flow regressions. Only OS storage and transport are replaced. */
@OptIn(ExperimentalCoroutinesApi::class)
class ContextAndRecoveryFlowTest {
    private val dispatcher = StandardTestDispatcher()
    @BeforeTest fun before() { Dispatchers.setMain(dispatcher) }
    @AfterTest fun after() { Dispatchers.resetMain() }

    @Test fun resetThenRetryKeepsExcludedHistoryOut() = runTest(dispatcher) {
        val store = SettingsSessionStore(MapSettings(), dispatcher, MemoryImages())
        val session = store.createSession("Context")
        fun message(id: String, role: ChatRole, text: String, status: MessageStatus, at: Long) =
            LocalMessage(id, session.id, role, text, status, at)
        store.replaceMessages(session.id, listOf(
            message("old-user", ChatRole.User, "OLD TOPIC TO EXCLUDE", MessageStatus.Complete, 1),
            message("old-assistant", ChatRole.Assistant, "Old answer", MessageStatus.Complete, 2),
            message("failed-user", ChatRole.User, "New failed request", MessageStatus.Complete, 3),
            message("failed-assistant", ChatRole.Assistant, "", MessageStatus.Error, 4),
        ))
        val manager = MobileContextManager(store) { _, _, _ -> error("No summary should run") }
        manager.reset(session.id)
        val context = store.getSession(session.id)!!.context
        assertEquals("failed-assistant", context.throughMessageId)
        assertTrue(manager.select(store.getMessages(session.id), context).isEmpty())
        val retry = prepareRetryTurn(store.getMessages(session.id), "failed-assistant")!!
        store.replaceMessages(session.id, retry.remainingMessages)
        val selected = manager.select(store.getMessages(session.id), store.getSession(session.id)!!.context)
        assertTrue(selected.isEmpty())
        val next = LocalMessage("new-user", session.id, ChatRole.User, "New topic", MessageStatus.Complete, 5)
        assertEquals(listOf(next), manager.select(store.getMessages(session.id) + next, context))
        val legacy = context.copy(throughCreatedAtEpochMs = null)
        assertTrue(manager.select(store.getMessages(session.id), legacy).isEmpty())
        assertEquals(listOf(next), manager.selectForPrompt(store.getMessages(session.id) + next, legacy, next))
    }

    @Test fun resetBoundarySurvivesSelectionCompactionAndBackup() = runTest(dispatcher) {
        val store = SettingsSessionStore(MapSettings(), dispatcher, MemoryImages())
        val session = store.createSession("Reset selection")
        fun turns(from: Int, to: Int) = (from..to).flatMap { n -> listOf(
            LocalMessage("u$n", session.id, ChatRole.User, "Question $n", MessageStatus.Complete, n * 2L),
            LocalMessage("a$n", session.id, ChatRole.Assistant, "Answer $n", MessageStatus.Complete, n * 2L + 1),
        ) }
        store.replaceMessages(session.id, turns(1, 3))
        val summarized = mutableListOf<String>()
        val manager = MobileContextManager(store) { _, messages, _ ->
            summarized += messages.joinToString("\n") { it.textContent }
            "Summary of new context"
        }
        manager.reset(session.id)
        suspend fun exclude(vararg ids: String) {
            val snapshot = manager.workspace(store.getSession(session.id)!!, store.getMessages(session.id))
            manager.updateSelection(session.id, snapshot.copy(excludedTurnIds = ids.toList()))
        }
        exclude("u3")
        assertTrue(manager.select(store.getMessages(session.id), store.getSession(session.id)!!.context).isEmpty())
        store.replaceMessages(session.id, turns(1, 8))
        assertTrue(manager.compact(session.id, "model", 32_000))
        assertFalse(summarized.joinToString().contains("Question 1"))
        exclude("u3", "u8")
        assertEquals(listOf("u4", "a4", "u5", "a5", "u6", "a6", "u7", "a7"),
            manager.select(store.getMessages(session.id), store.getSession(session.id)!!.context).map { it.id })
        val archive = store.exportMigrationData(1_000_000)
        val restored = SettingsSessionStore(MapSettings(), dispatcher, MemoryImages())
        restored.importMigrationData(archive)
        val restoredManager = MobileContextManager(restored) { _, _, _ -> error("No summary") }
        assertEquals(listOf("u4", "a4", "u5", "a5", "u6", "a6", "u7", "a7"),
            restoredManager.select(restored.getMessages(session.id), restored.getSession(session.id)!!.context).map { it.id })
        assertEquals(16, restored.getMessages(session.id).size)
    }

    @Test fun legacyResetBoundaryIsPreservedWhenEditingSelection() = runTest(dispatcher) {
        val store = SettingsSessionStore(MapSettings(), dispatcher, MemoryImages())
        val session = store.createSession("Legacy reset")
        val history = (1..3).flatMap { n -> listOf(
            LocalMessage("u$n", session.id, ChatRole.User, "Question $n", MessageStatus.Complete, n * 2L),
            LocalMessage("a$n", session.id, ChatRole.Assistant, "Answer $n", MessageStatus.Complete, n * 2L + 1),
        ) }
        store.replaceMessages(session.id, history)
        store.updateSession(session.copy(context = MobileSessionContext(throughMessageId = "a2", throughCreatedAtEpochMs = 5)))
        val manager = MobileContextManager(store) { _, _, _ -> error("No summary") }
        val snapshot = manager.workspace(store.getSession(session.id)!!, history)
        manager.updateSelection(session.id, snapshot.copy(excludedTurnIds = listOf("u3")))
        assertTrue(manager.select(history, store.getSession(session.id)!!.context).isEmpty())
    }

    @Test fun successfulCompactionKeepsRecentTurnsAndContextSurvivesBackup() = runTest(dispatcher) {
        val store = SettingsSessionStore(MapSettings(), dispatcher, MemoryImages())
        val session = store.createSession("Healthy context")
        val history = (1..4).flatMap { n -> listOf(
            LocalMessage("u$n", session.id, ChatRole.User, "Question $n", MessageStatus.Complete, n * 2L),
            LocalMessage("a$n", session.id, ChatRole.Assistant, "Answer $n", MessageStatus.Complete, n * 2L + 1),
        ) }
        store.replaceMessages(session.id, history)
        val manager = MobileContextManager(store) { _, _, _ -> "Summary of the first turn" }
        assertTrue(manager.compact(session.id, "isolated-model", 32_000))
        val updated = store.getSession(session.id)!!
        assertEquals("a1", updated.context.throughMessageId)
        assertEquals(listOf("u2", "a2", "u3", "a3", "u4", "a4"), manager.select(store.getMessages(session.id), updated.context).map { it.id })
        assertEquals(history, store.getMessages(session.id))
        val archive = store.exportMigrationData(1_000_000)
        val restored = SettingsSessionStore(MapSettings(), dispatcher, MemoryImages())
        assertEquals(1, restored.importMigrationData(archive))
        assertEquals(updated.context, restored.getSession(session.id)!!.context)
        assertEquals(history, restored.getMessages(session.id))
    }

    @Test fun manualCompactionOfThreeTurnsKeepsLatestTurnAndPersistsSummary() = runTest(dispatcher) {
        val settings = MapSettings()
        val images = MemoryImages()
        val store = SettingsSessionStore(settings, dispatcher, images)
        val session = store.createSession("Manual context")
        val history = (1..3).flatMap { n -> listOf(
            LocalMessage("u$n", session.id, ChatRole.User, "Question $n " + "facts ".repeat(100), MessageStatus.Complete, n * 2L),
            LocalMessage("a$n", session.id, ChatRole.Assistant, "Answer $n " + "details ".repeat(100), MessageStatus.Complete, n * 2L + 1),
        ) }
        store.replaceMessages(session.id, history)
        val manager = MobileContextManager(store) { _, _, _ -> "Concise summary of the first two turns" }
        assertTrue(manager.compact(session.id, "isolated-model", 32_000, manual = true))
        val restored = SettingsSessionStore(settings, dispatcher, images)
        val updated = restored.getSession(session.id)!!
        assertEquals("a2", updated.context.throughMessageId)
        assertEquals(listOf("u3", "a3"), manager.select(restored.getMessages(session.id), updated.context).map { it.id })
        assertEquals(history, restored.getMessages(session.id))
        assertTrue(manager.snapshot(updated, history, 32_000).tokens!! < manager.snapshot(session, history, 32_000).tokens!!)
    }

    @Test fun manualSingleTurnDoesNotCallModelAndNonReducingSummaryPreservesHistory() = runTest(dispatcher) {
        val store = SettingsSessionStore(MapSettings(), dispatcher, MemoryImages())
        val session = store.createSession("Short context")
        val history = (1..2).flatMap { n -> listOf(
            LocalMessage("u$n", session.id, ChatRole.User, "Q$n", MessageStatus.Complete, n * 2L),
            LocalMessage("a$n", session.id, ChatRole.Assistant, "A$n", MessageStatus.Complete, n * 2L + 1),
        ) }
        var calls = 0
        val manager = MobileContextManager(store) { _, _, _ -> calls++; "A much longer summary than the tiny original conversation." }
        store.replaceMessages(session.id, history.take(2))
        assertFalse(manager.compact(session.id, "model", 32000, manual = true))
        assertEquals(0, calls)
        store.replaceMessages(session.id, history)
        assertFailsWith<MobileContextException> { manager.compact(session.id, "model", 32000, manual = true) }
        assertEquals(session.context, store.getSession(session.id)!!.context)
        assertEquals(history, store.getMessages(session.id))
    }

    @Test fun cancellingSummaryPreservesOriginalContextAndHistory() = runTest(dispatcher) {
        val store = SettingsSessionStore(MapSettings(), dispatcher, MemoryImages())
        val session = store.createSession("Cancelled context")
        val history = (1..4).flatMap { n -> listOf(
            LocalMessage("u$n", session.id, ChatRole.User, "Question $n", MessageStatus.Complete, n * 2L),
            LocalMessage("a$n", session.id, ChatRole.Assistant, "Answer $n", MessageStatus.Complete, n * 2L + 1),
        ) }
        store.replaceMessages(session.id, history)
        val entered = CompletableDeferred<Unit>()
        val reply = CompletableDeferred<String>()
        val manager = MobileContextManager(store) { _, _, _ -> entered.complete(Unit); reply.await() }
        val job = launch { manager.compact(session.id, "isolated-model", 32_000) }
        entered.await()
        job.cancelAndJoin()
        assertEquals(session.context, store.getSession(session.id)!!.context)
        assertEquals(history, store.getMessages(session.id))
    }

    @Test fun repeatedRecoverySnapshotPreservesSelectedAnswerWithoutResubmittingPrompt() = runTest(dispatcher) {
        val transports = mutableListOf<ReviewTransport>()
        val gateway = RelayRemoteConversationGateway(backgroundScope, { ReviewTransport(true).also(transports::add) }, { 1_000L })
        gateway.connect("wss://review.invalid/relay")
        val store = SettingsSessionStore(MapSettings(), dispatcher, MemoryImages())
        val container = AppContainer(AppPreferences(MapSettings()), InMemoryTokenStore(), store, gateway, MutableStateFlow(NetworkAvailability.Available))
        val vm = AppViewModel(container)
        runCurrent()
        vm.startDesktopConversation("desktop-1")
        runCurrent()
        val sid = assertNotNull(vm.state.value.currentSessionId)
        vm.onDraftChange("Keep the current task")
        vm.sendMessage()
        runCurrent()
        assertEquals(1, transports.sumOf { it.prompts.size })
        transports.first().drop()
        runCurrent()
        advanceTimeBy(1_250)
        runCurrent()
        val first = assertNotNull(vm.state.value.pendingQuestion)
        assertEquals("question-1", first.requestId)
        vm.toggleQuestionOption("Continue?", "Go")
        runCurrent()
        assertEquals(listOf("Go"), vm.state.value.pendingQuestion!!.selections["Continue?"])
        assertEquals(listOf("Go"), store.getMessages(sid).last().pendingQuestion!!.selections["Continue?"])
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(listOf("Go"), vm.state.value.pendingQuestion!!.selections["Continue?"])
        assertEquals(listOf("Go"), store.getMessages(sid).last().pendingQuestion!!.selections["Continue?"])
        assertEquals(1, transports.sumOf { it.prompts.size })
        vm.submitQuestion()
        runCurrent()
        advanceTimeBy(1_000)
        runCurrent()
        assertNull(vm.state.value.pendingQuestion)
        assertNull(store.getMessages(sid).last().pendingQuestion)
        vm.stopStreaming()
        runCurrent()
        gateway.disconnect("desktop-1")
        container.client.close()
    }

    @Test fun truncatedRecoveryLoadsFullHistoryAndKeepsRecoveredToolTrace() = runTest(dispatcher) {
        val transports = mutableListOf<ReviewTransport>()
        val gateway = RelayRemoteConversationGateway(backgroundScope, { ReviewTransport(true, true).also(transports::add) }, { 1_000L })
        gateway.connect("wss://review.invalid/relay")
        val store = SettingsSessionStore(MapSettings(), dispatcher, MemoryImages())
        val container = AppContainer(AppPreferences(MapSettings()), InMemoryTokenStore(), store, gateway, MutableStateFlow(NetworkAvailability.Available))
        val vm = AppViewModel(container)
        runCurrent()
        vm.startDesktopConversation("desktop-1")
        runCurrent()
        val sid = assertNotNull(vm.state.value.currentSessionId)
        vm.onDraftChange("Long response")
        vm.sendMessage()
        runCurrent()
        transports.first().drop()
        runCurrent()
        advanceTimeBy(1_250)
        runCurrent()
        val assistant = store.getMessages(sid).single { it.role == ChatRole.Assistant }
        assertEquals("Recovered prefix and full response", assistant.content)
        assertEquals("artifact-tool", assistant.toolEvents.single().toolCallId)
        assertFalse(vm.state.value.isStreaming)
        assertEquals(1, transports.sumOf { it.prompts.size })
        gateway.disconnect("desktop-1")
        container.client.close()
    }

    @Test fun retryPreparationForACancelsWhenUserSwitchesToB() = runTest(dispatcher) {
        val transport = ReviewTransport(false)
        val gateway = RelayRemoteConversationGateway(backgroundScope, { transport }, { 1_000L })
        gateway.connect("wss://review.invalid/relay")
        val io = GateDispatcher(dispatcher)
        val store = SettingsSessionStore(MapSettings(), io, MemoryImages())
        val a = store.createSession("A", origin = ConversationOrigin.Desktop, remoteDeviceId = "desktop-1", remoteSessionId = "remote-A")
        val b = store.createSession("B", origin = ConversationOrigin.Desktop, remoteDeviceId = "desktop-1", remoteSessionId = "remote-B")
        store.replaceMessages(a.id, listOf(
            LocalMessage("a-user", a.id, ChatRole.User, "Secret from A", MessageStatus.Complete, 1),
            LocalMessage("a-error", a.id, ChatRole.Assistant, "", MessageStatus.Error, 2),
        ))
        val container = AppContainer(AppPreferences(MapSettings()), InMemoryTokenStore(), store, gateway, MutableStateFlow(NetworkAvailability.Available))
        val vm = AppViewModel(container)
        runCurrent()
        vm.openChat(a.id, ChatSurface.Desktop, "A", "desktop-1")
        runCurrent()
        assertEquals(a.id, vm.state.value.currentSessionId)
        io.paused = true
        vm.retryLastError("a-error")
        runCurrent()
        assertTrue(io.queued > 0)
        vm.openChat(b.id, ChatSurface.Desktop, "B", "desktop-1")
        assertEquals(b.id, vm.state.value.currentSessionId)
        io.resume()
        runCurrent()
        assertEquals(listOf("a-user", "a-error"), store.getMessages(a.id).map { it.id })
        assertTrue(store.getMessages(b.id).isEmpty())
        assertTrue(transport.prompts.isEmpty())
        assertEquals("", vm.state.value.draft)
        gateway.disconnect("desktop-1")
        container.client.close()
    }
}

private class GateDispatcher(private val delegate: CoroutineDispatcher) : CoroutineDispatcher() {
    var paused = false
    private val pending = ArrayDeque<Pair<CoroutineContext, Runnable>>()
    val queued get() = pending.size
    override fun dispatch(context: CoroutineContext, block: Runnable) {
        if (paused) pending.addLast(context to block) else delegate.dispatch(context, block)
    }
    fun resume() { paused = false; while (pending.isNotEmpty()) { val (c, r) = pending.removeFirst(); delegate.dispatch(c, r) } }
}
private class MemoryImages : MessageImageFileStore {
    private val data = mutableMapOf<String, ByteArray>()
    override fun writeBytes(key: String, bytes: ByteArray): Boolean { data[key] = bytes.copyOf(); return true }
    override fun writeBase64(key: String, base64Data: String): Boolean = error("unused")
    override fun readBytes(key: String): ByteArray? = data[key]?.copyOf()
    override fun delete(key: String) { data.remove(key) }
}
private class ReviewTransport(private val recoverQuestion: Boolean, private val largeRecovery: Boolean = false) : RemoteTransport {
    private val channel = Channel<RemoteFrame>(Channel.UNLIMITED)
    override val incoming = channel.receiveAsFlow()
    val prompts = mutableListOf<RemoteRequest>()
    var snapshotReads = 0
    private var seq = 0L
    override suspend fun connect() = Unit
    override suspend fun close() { channel.close() }
    fun drop() { channel.close() }
    private fun catalog() = buildJsonObject {
        put("models", buildJsonArray {})
        put("lastUserMessageId", "desktop-last-user")
    }
    override suspend fun send(frame: RemoteFrame) {
        when (frame) {
            is RemoteHello -> channel.send(RemoteHelloAck(connectionId = frame.connectionId, peerDeviceId = "desktop-1"))
            is RemoteRequest -> {
                val payload = when(frame.method) {
                    RemoteRequestMethod.SessionList -> buildJsonObject {
                        put("sessions", buildJsonArray {})
                        put("supportedMethods", buildJsonArray { add(JsonPrimitive("session.turn.read")) })
                    }
                    RemoteRequestMethod.SessionCreate -> buildJsonObject { put("sessionId", "remote-review"); put("modelCatalog", catalog()) }
                    RemoteRequestMethod.SessionOpen -> buildJsonObject { put("sessionId", frame.sessionId ?: "remote-review") }
                    RemoteRequestMethod.SessionModels -> catalog()
                    RemoteRequestMethod.SessionHistory -> buildJsonObject {
                        put("messages", buildJsonArray {
                            if (largeRecovery) add(buildJsonObject {
                                put("id", "assistant-history"); put("role", "assistant"); put("text", "Recovered prefix and full response"); put("timestamp", 2_000)
                            })
                        })
                    }
                    RemoteRequestMethod.SessionTurnRead -> buildJsonObject {
                        snapshotReads++
                        put("found", true); put("state", if (largeRecovery) "completed" else "running"); put("text", if (largeRecovery) "Recovered prefix" else "")
                        put("truncated", largeRecovery)
                        put("tools", buildJsonArray {
                            if (largeRecovery) add(buildJsonObject {
                                put("toolCallId", "artifact-tool"); put("toolName", "files"); put("phase", "finished")
                            })
                        })
                        put("input", buildJsonObject {
                            put("kind", "question"); put("requestId", "question-1")
                            put("questions", buildJsonArray { add(buildJsonObject {
                                put("question", "Continue?")
                                put("options", buildJsonArray { add(buildJsonObject { put("label", "Go") }) })
                            }) })
                        })
                    }
                    RemoteRequestMethod.SessionPrompt -> {
                        prompts += frame
                        if (!recoverQuestion) {
                            channel.send(RemoteEvent("done-${++seq}", seq, RemoteEventName.SessionState, frame.sessionId, buildJsonObject { put("state", "completed") }))
                        }
                        buildJsonObject { put("sessionId", frame.sessionId ?: "remote-review") }
                    }
                    else -> buildJsonObject {}
                }
                channel.send(RemoteResponse(frame.requestId, true, payload = payload))
            }
            else -> Unit
        }
    }
}
