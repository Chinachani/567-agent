package org.agent567.android.domain.conversation

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.agent567.android.core.model.ChatMessage
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatStreamEvent
import org.agent567.android.domain.remote.connection.RemoteTransport
import org.agent567.android.domain.remote.protocol.RemoteEvent
import org.agent567.android.domain.remote.protocol.RemoteEventName
import org.agent567.android.domain.remote.protocol.RemoteFrame
import org.agent567.android.domain.remote.protocol.RemoteHello
import org.agent567.android.domain.remote.protocol.RemoteHelloAck
import org.agent567.android.domain.remote.protocol.RemoteRequest
import org.agent567.android.domain.remote.protocol.RemoteRequestMethod
import org.agent567.android.domain.remote.protocol.RemoteResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class RelayRemoteTurnGatewayTest {
    @Test
    fun streamWithAttachmentsForwardsExplicitRemoteTurnIdOnPrompt() =
        runTest {
            val transport = TurnRecoveryTransport(
                onTurnRead = { buildJsonObject { put("found", false) } },
            )
            val gateway = RelayRemoteConversationGateway(
                scope = backgroundScope,
                transportFactory = { transport },
                now = { 1_000L },
            )
            assertTrue(gateway.connect("fake-relay"))

            val events = mutableListOf<ChatStreamEvent>()
            gateway.streamWithAttachments(
                localSessionId = "local-1",
                deviceId = "desktop-1",
                remoteSessionId = "remote-1",
                messages = listOf(ChatMessage(ChatRole.User, "hello")),
                retryPreviousTurn = false,
                promptText = "hello",
                files = emptyList(),
                remoteTurnId = "mobile_turn_99",
            ).collect { events += it }

            val promptRequest = transport.requests.single { it.method == RemoteRequestMethod.SessionPrompt }
            assertEquals("mobile_turn_99", promptRequest.payload?.jsonObject?.get("turnId")?.jsonPrimitive?.content)
            assertEquals("ok", (events.first { it is ChatStreamEvent.Delta } as ChatStreamEvent.Delta).text)
            assertEquals(ChatStreamEvent.Done, events.last())
        }

    @Test
    fun recoverRemoteTurnReadsCompletedTurnFromSessionTurnReadWithoutResendingPrompt() =
        runTest {
            val transport = TurnRecoveryTransport(
                onTurnRead = {
                    buildJsonObject {
                        put("found", true)
                        put("state", "completed")
                        put("text", "桌面已完成回复")
                        put("tools", JsonArray(emptyList()))
                        put("eventCursor", 2)
                    }
                },
            )
            val gateway = RelayRemoteConversationGateway(
                scope = backgroundScope,
                transportFactory = { transport },
                now = { 1_000L },
            )
            assertTrue(gateway.connect("fake-relay"))

            val events = mutableListOf<ChatStreamEvent>()
            gateway.recoverRemoteTurn(
                localSessionId = "local-1",
                deviceId = "desktop-1",
                remoteSessionId = "remote-1",
                turnId = "mobile_turn_42",
            ).collect { events += it }

            val readRequest = transport.requests.single { it.method == RemoteRequestMethod.SessionTurnRead }
            assertEquals("remote-1", readRequest.sessionId)
            assertEquals("mobile_turn_42", readRequest.payload?.jsonObject?.get("turnId")?.jsonPrimitive?.content)
            assertTrue(transport.requests.none { it.method == RemoteRequestMethod.SessionPrompt })

            val snapshot = events.first { it is ChatStreamEvent.Snapshot } as ChatStreamEvent.Snapshot
            assertEquals("桌面已完成回复", snapshot.text)
            assertEquals("completed", snapshot.state)
            assertEquals(ChatStreamEvent.Done, events.last())
        }

    @Test
    fun recoverRemoteTurnThrowsRemoteTurnNotFoundWhenDesktopReportsFoundFalse() =
        runTest {
            val transport = TurnRecoveryTransport(
                onTurnRead = {
                    buildJsonObject {
                        put("found", false)
                        put("eventCursor", 1)
                    }
                },
            )
            val gateway = RelayRemoteConversationGateway(
                scope = backgroundScope,
                transportFactory = { transport },
                now = { 1_000L },
            )
            assertTrue(gateway.connect("fake-relay"))

            assertFailsWith<RemoteTurnNotFoundException> {
                gateway.recoverRemoteTurn(
                    localSessionId = "local-1",
                    deviceId = "desktop-1",
                    remoteSessionId = "remote-1",
                    turnId = "mobile_missing",
                ).collect {}
            }
        }
}

private class TurnRecoveryTransport(
    private val onTurnRead: (RemoteRequest) -> JsonObject,
) : RemoteTransport {
    private val channel = Channel<RemoteFrame>(Channel.UNLIMITED)
    private var seq = 1L
    val requests = mutableListOf<RemoteRequest>()

    override val incoming: Flow<RemoteFrame> = channel.receiveAsFlow()

    override suspend fun connect() = Unit

    override suspend fun send(frame: RemoteFrame) {
        when (frame) {
            is RemoteHello -> {
                channel.send(RemoteHelloAck(connectionId = frame.connectionId, peerDeviceId = "desktop-1"))
                channel.send(
                    RemoteEvent(
                        eventId = "e-online",
                        sequence = seq++,
                        name = RemoteEventName.DeviceStatus,
                        payload = buildJsonObject {
                            put("deviceId", "desktop-1")
                            put("deviceName", "Desk")
                            put("osLabel", "Linux")
                            put("online", true)
                        },
                    ),
                )
            }
            is RemoteRequest -> {
                requests += frame
                when (frame.method) {
                    RemoteRequestMethod.SessionList -> channel.send(
                        RemoteResponse(
                            frame.requestId,
                            true,
                            buildJsonObject {
                                put("sessions", JsonArray(emptyList()))
                                put(
                                    "supportedMethods",
                                    buildJsonArray {
                                        add(kotlinx.serialization.json.JsonPrimitive("session.turn.read"))
                                        add(kotlinx.serialization.json.JsonPrimitive("session.create"))
                                    },
                                )
                            },
                        ),
                    )
                    RemoteRequestMethod.SessionModels -> channel.send(
                        RemoteResponse(frame.requestId, true, buildJsonObject { put("models", JsonArray(emptyList())) }),
                    )
                    RemoteRequestMethod.SessionTurnRead -> channel.send(
                        RemoteResponse(frame.requestId, true, onTurnRead(frame)),
                    )
                    RemoteRequestMethod.SessionPrompt -> {
                        val sid = frame.sessionId ?: "remote-1"
                        channel.send(
                            RemoteResponse(
                                frame.requestId,
                                true,
                                buildJsonObject {
                                    put("accepted", true)
                                    put("sessionId", sid)
                                },
                            ),
                        )
                        channel.send(
                            RemoteEvent(
                                eventId = "e-msg",
                                sequence = seq++,
                                name = RemoteEventName.SessionMessage,
                                sessionId = sid,
                                payload = buildJsonObject { put("text", "ok") },
                            ),
                        )
                        channel.send(
                            RemoteEvent(
                                eventId = "e-done",
                                sequence = seq++,
                                name = RemoteEventName.SessionState,
                                sessionId = sid,
                                payload = buildJsonObject { put("state", "completed") },
                            ),
                        )
                    }
                    else -> channel.send(RemoteResponse(frame.requestId, true, buildJsonObject { put("ok", true) }))
                }
            }
            else -> Unit
        }
    }

    override suspend fun close() {
        channel.close()
    }
}
