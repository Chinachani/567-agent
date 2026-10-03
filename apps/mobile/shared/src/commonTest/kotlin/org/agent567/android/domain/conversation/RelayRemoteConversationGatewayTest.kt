package org.agent567.android.domain.conversation

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.buildJsonArray
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.domain.remote.connection.RemoteTransport
import org.agent567.android.domain.remote.protocol.RemoteEvent
import org.agent567.android.domain.remote.protocol.RemoteEventName
import org.agent567.android.domain.remote.protocol.RemoteFrame
import org.agent567.android.domain.remote.protocol.RemoteHelloAck
import org.agent567.android.domain.remote.protocol.RemoteRequest
import org.agent567.android.domain.remote.protocol.RemoteResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

@OptIn(ExperimentalCoroutinesApi::class)
class RelayRemoteConversationGatewayTest {
    @Test
    fun reconnectsAutomaticallyAfterTransportDrop() =
        runTest {
            val transports = mutableListOf<FakeGatewayTransport>()
            val gateway = RelayRemoteConversationGateway(
                scope = backgroundScope,
                transportFactory = { FakeGatewayTransport().also(transports::add) },
                now = { 1_000L },
            )
            gateway.connect("fake-relay")
            assertEquals(1, transports.size)

            transports.single().drop()
            runCurrent()
            advanceTimeBy(1_000L)
            runCurrent()

            assertEquals(2, transports.size)
            assertEquals(DeviceStatus.Online, gateway.devices.value.single().status)
            gateway.disconnect("desktop-1")
        }

    @Test
    fun reconnectFallsBackFromStaleLanTargetToCloudTarget() =
        runTest {
            var lanAttempts = 0
            val transports = mutableListOf<Pair<String, FakeGatewayTransport>>()
            val gateway = RelayRemoteConversationGateway(
                scope = backgroundScope,
                transportFactory = { url ->
                    val acceptsHello = !url.contains("lan-host") || ++lanAttempts == 1
                    FakeGatewayTransport(acceptHello = acceptsHello).also { transports += url to it }
                },
                now = { 1_000L },
            )
            gateway.connect(listOf("wss://lan-host/relay/pair/mobile", "wss://cloud-host/relay/pair/mobile"))
            assertEquals("wss://lan-host/relay/pair/mobile", gateway.devices.value.single().host)

            transports.first().second.drop()
            runCurrent()
            advanceTimeBy(4_000L)
            runCurrent()

            assertEquals("wss://cloud-host/relay/pair/mobile", gateway.devices.value.single().host)
            assertEquals(DeviceStatus.Online, gateway.devices.value.single().status)
            gateway.disconnect("desktop-1")
        }

    @Test
    fun connectFallsBackToCloudWhenLanHandshakeTimesOut() =
        runTest {
            val attemptedUrls = mutableListOf<String>()
            val gateway = RelayRemoteConversationGateway(
                scope = backgroundScope,
                transportFactory = { url ->
                    attemptedUrls += url
                    FakeGatewayTransport(acceptHello = !url.contains("lan-host"))
                },
                now = { 1_000L },
            )

            gateway.connect(listOf("wss://lan-host/relay/pair/mobile", "wss://cloud-host/relay/pair/mobile"))

            assertEquals(
                listOf("wss://lan-host/relay/pair/mobile", "wss://cloud-host/relay/pair/mobile"),
                attemptedUrls,
            )
            assertEquals("wss://cloud-host/relay/pair/mobile", gateway.devices.value.single().host)
            assertEquals(DeviceStatus.Online, gateway.devices.value.single().status)
            gateway.disconnect("desktop-1")
        }

    @Test
    fun firstPromptAcceptsOpaqueSessionIdFromDesktopEvent() =
        runTest {
            val transport = FakeGatewayTransport()
            val gateway =
                RelayRemoteConversationGateway(
                    scope = backgroundScope,
                    transportFactory = { transport },
                    now = { 1_000L },
                )
            gateway.connect("fake-relay")

            val device = gateway.devices.value.single()
            assertEquals("Windows 11", device.osLabel)
            assertEquals("Test CPU", device.cpu)
            assertEquals("16 GB", device.ram)
            assertEquals(0, device.latencyMs)
            assertEquals("1秒", device.connectedDuration)

            val events = mutableListOf<ChatStreamEvent>()
            gateway
                .stream(
                    localSessionId = "local-session-1",
                    deviceId = "desktop-1",
                    remoteSessionId = null,
                    messages = listOf(ChatMessage(ChatRole.User, "hello")),
                ).collect { events += it }

            assertEquals("answer", (events.first() as ChatStreamEvent.Delta).text)
            assertEquals(ChatStreamEvent.Done, events.last())
            assertEquals("runtime-session-1", gateway.resolvedRemoteSessionId("local-session-1"))
        }

    @Test
    fun streamMapsToolAndUserInputEventsWithoutDroppingTheTurn() =
        runTest {
            val transport = FakeGatewayTransport(richEvents = true)
            val gateway = RelayRemoteConversationGateway(scope = backgroundScope, transportFactory = { transport }, now = { 1_000L })
            gateway.connect("fake-relay")
            val events = mutableListOf<ChatStreamEvent>()
            gateway.stream("local", "desktop-1", null, listOf(ChatMessage(ChatRole.User, "hello"))).collect { events += it }
            assertEquals(
                ChatStreamEvent.Tool(
                    "started",
                    "call-1",
                    "read_file",
                    "{\"path\":\"README.md\"}",
                    null,
                    "{\"path\":\"README.md\"}",
                    null,
                ),
                events[0],
            )
            assertEquals(
                ChatStreamEvent.Tool(
                    phase = "phase",
                    toolCallId = "call-1",
                    toolName = "read_file",
                    phaseLabel = "读取文件内容",
                ),
                events[1],
            )
            assertEquals("req-1", (events[2] as ChatStreamEvent.UserInputRequired).requestId)
            assertEquals(125, (events[3] as ChatStreamEvent.State).usage?.totalTokens)
            assertEquals(ChatStreamEvent.Done, events.last())
        }

    @Test
    fun terminalRemoteErrorKeepsTheDesktopErrorCategory() =
        runTest {
            val transport = FakeGatewayTransport(terminalErrorCode = "unauthorized")
            val gateway = RelayRemoteConversationGateway(scope = backgroundScope, transportFactory = { transport }, now = { 1_000L })
            gateway.connect("fake-relay")
            val error = assertFailsWith<org.agent567.android.domain.remote.connection.RemoteRequestException> {
                gateway.stream("local", "desktop-1", null, listOf(ChatMessage(ChatRole.User, "hello"))).collect { }
            }
            assertEquals(org.agent567.android.domain.remote.protocol.RemoteErrorCode.Unauthorized, error.remoteError.code)
        }

    @Test
    fun transportRecoveryEndsTheTurnWithAnActionableError() =
        runTest {
            val transport = FakeGatewayTransport(disconnectOnPrompt = true)
            val gateway = RelayRemoteConversationGateway(scope = backgroundScope, transportFactory = { transport }, now = { 1_000L })
            gateway.connect("fake-relay")

            val error = assertFailsWith<org.agent567.android.domain.remote.connection.RemoteRequestException> {
                gateway.stream("local", "desktop-1", null, listOf(ChatMessage(ChatRole.User, "hello"))).collect { }
            }

            assertEquals(org.agent567.android.domain.remote.protocol.RemoteErrorCode.TransportClosed, error.remoteError.code)
        }
}

private class FakeGatewayTransport(
    private val richEvents: Boolean = false,
    private val terminalErrorCode: String? = null,
    private val disconnectOnPrompt: Boolean = false,
    private val acceptHello: Boolean = true,
) : RemoteTransport {
    private val channel = Channel<RemoteFrame>(Channel.UNLIMITED)
    override val incoming: Flow<RemoteFrame> = channel.receiveAsFlow()

    override suspend fun connect() = Unit

    override suspend fun send(frame: RemoteFrame) {
        when (frame) {
            is org.agent567.android.domain.remote.protocol.RemoteHello ->
                if (acceptHello) channel.send(RemoteHelloAck(connectionId = frame.connectionId, peerDeviceId = "desktop-1"))
            is RemoteRequest -> {
                if (frame.method == org.agent567.android.domain.remote.protocol.RemoteRequestMethod.DiagnosticsSnapshot) {
                    channel.send(
                        RemoteResponse(
                            requestId = frame.requestId,
                            success = true,
                            payload = buildJsonObject {
                                put("osLabel", "Windows 11")
                                put("cpu", "Test CPU")
                                put("ram", "16 GB")
                            },
                        ),
                    )
                    return
                }
                if (disconnectOnPrompt) {
                    channel.close()
                    return
                }
                if (richEvents) {
                    channel.send(RemoteEvent("tool-1", 1, RemoteEventName.SessionTool, "runtime-session-1", buildJsonObject {
                        put("phase", "started")
                        put("toolCallId", "call-1")
                        put("toolName", "read_file")
                        put("args", "{\"path\":\"README.md\"}")
                    }))
                    channel.send(RemoteEvent("phase-1", 2, RemoteEventName.SessionTool, "runtime-session-1", buildJsonObject {
                        put("phase", "phase")
                        put("toolCallId", "call-1")
                        put("toolName", "read_file")
                        put("label", "读取文件内容")
                    }))
                    channel.send(RemoteEvent("input-1", 3, RemoteEventName.SessionInput, "runtime-session-1", buildJsonObject {
                        put("kind", "question")
                        put("requestId", "req-1")
                        put("questions", buildJsonArray { add(buildJsonObject { put("question", "继续吗？"); put("header", "确认"); put("options", buildJsonArray { add(buildJsonObject { put("label", "继续") }) }) }) })
                    }))
                    channel.send(RemoteEvent("usage-1", 4, RemoteEventName.SessionState, "runtime-session-1", buildJsonObject {
                        put("state", "usage")
                        put("input", 100)
                        put("output", 25)
                        put("total", 125)
                        put("contextPercent", 12)
                    }))
                } else {
                    channel.send(RemoteEvent("event-1", 1, RemoteEventName.SessionMessage, "runtime-session-1", buildJsonObject { put("text", "answer") }))
                }
                channel.send(RemoteEvent("state-1", if (richEvents) 5 else 2, RemoteEventName.SessionState, "runtime-session-1", buildJsonObject {
                    put("state", if (terminalErrorCode == null) "completed" else "error")
                    terminalErrorCode?.let { put("code", it) }
                    terminalErrorCode?.let { put("message", "Desktop model authentication failed") }
                }))
                channel.send(
                    RemoteResponse(
                        requestId = frame.requestId,
                        success = true,
                        payload = buildJsonObject {
                            put("sessionId", "runtime-session-1")
                        },
                    ),
                )
            }
            else -> Unit
        }
    }

    override suspend fun close() {
        channel.close()
    }

    fun drop() {
        channel.close()
    }
}
