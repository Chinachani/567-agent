package org.agent567.android.domain.remote.connection

import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.http.HttpHeaders
import io.ktor.http.takeFrom
import io.ktor.websocket.Frame
import io.ktor.websocket.close
import io.ktor.websocket.readText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import org.agent567.android.core.net.platformHttpClientEngine
import org.agent567.android.core.net.pinnedWebSocketHttpClient
import org.agent567.android.domain.remote.protocol.RemoteFrame
import org.agent567.android.domain.remote.protocol.RemoteProtocol

class KtorWebSocketRemoteTransport(
    private val url: String,
    private val scope: CoroutineScope,
    private val client: HttpClient? = null,
) : RemoteTransport {
    private val incomingChannel = Channel<RemoteFrame>(Channel.UNLIMITED)
    private var session: DefaultClientWebSocketSession? = null
    private var readerJob: Job? = null
    private var activeClient: HttpClient? = null

    override val incoming: Flow<RemoteFrame> = incomingChannel.receiveAsFlow()

    override suspend fun connect() {
		val target = splitPairingTarget(url)
        val fingerprint = target.fingerprint
		val client =
			(this.client ?: if (fingerprint == null) {
				HttpClient(platformHttpClientEngine()) { install(WebSockets) }
			} else {
				pinnedWebSocketHttpClient(fingerprint)
			}).also { activeClient = it }
        val socket =
            client.webSocketSession {
				url.takeFrom(target.url)
				target.pairingToken?.let {
                    headers.append(
                        HttpHeaders.SecWebSocketProtocol,
						listOfNotNull("vetta.remote.v1", "vetta.pairing.$it", target.resumeToken?.let { token -> "vetta.resume.$token" }).joinToString(", "),
                    )
                }
            }
        session = socket
        readerJob?.cancel()
        readerJob =
            scope.launch {
                try {
                    for (frame in socket.incoming) {
                        if (frame is Frame.Text) incomingChannel.send(RemoteProtocol.decode(frame.readText()))
                    }
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (error: Throwable) {
                    // A network handoff commonly aborts the underlying TCP socket.
                    // Let RemoteConnection observe the closed incoming flow and run
                    // its reconnect loop instead of crashing the Android process.
                    PlatformRemoteLogger.warn(
                        "remote websocket reader stopped",
                        mapOf("message" to error.message),
                    )
                } finally {
                    incomingChannel.close()
                }
            }
    }

    override suspend fun send(frame: RemoteFrame) {
        session?.send(Frame.Text(RemoteProtocol.encode(frame)))
            ?: error("remote websocket is not connected")
    }

    override suspend fun close() {
        readerJob?.cancel()
        readerJob = null
        try {
            session?.close()
        } finally {
            session = null
            activeClient?.close()
            activeClient = null
        }
    }

    private data class Target(val url: String, val pairingToken: String?, val resumeToken: String?, val fingerprint: String?)

    private fun splitPairingTarget(target: String): Target {
        val separator = target.indexOf('#')
		if (separator < 0) return Target(target, null, null, null)
		val fragment = target.substring(separator + 1)
		if (!fragment.contains('=')) return Target(target.substring(0, separator), fragment.takeIf { it.isNotEmpty() }, null, null)
		val values = fragment.split('&').mapNotNull {
			val index = it.indexOf('=')
			if (index <= 0) null else it.substring(0, index) to java.net.URLDecoder.decode(it.substring(index + 1), "UTF-8")
		}.toMap()
		val fingerprint = values["fingerprint"]?.lowercase()
		if (fingerprint != null && !fingerprint.matches(Regex("[a-f0-9]{64}"))) error("Invalid certificate fingerprint")
		return Target(target.substring(0, separator), values["pairing"], values["resume"], fingerprint)
    }
}
