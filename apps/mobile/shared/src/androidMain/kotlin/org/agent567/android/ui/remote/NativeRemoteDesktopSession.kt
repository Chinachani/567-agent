package org.agent567.android.ui.remote

import android.content.Context
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.DefaultClientWebSocketSession
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.http.HttpHeaders
import io.ktor.http.takeFrom
import io.ktor.websocket.Frame
import io.ktor.websocket.readText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.int
import kotlinx.serialization.json.put
import org.agent567.android.domain.remote.connection.PlatformRemoteLogger
import org.agent567.android.domain.remote.SignalingDrop
import org.agent567.android.domain.remote.SignalingRetry
import org.agent567.android.domain.remote.RemoteStreamStats
import org.agent567.android.core.net.platformWebSocketHttpClient
import org.agent567.android.core.net.pinnedWebSocketHttpClient
import org.agent567.android.ui.i18n.Str
import org.webrtc.DataChannel
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

private const val PROTOCOL_VERSION = 1
private const val INPUT_CHANNEL = "vetta-input-v1"

class NativeRemoteDesktopSession(private val context: Context, private val target: String) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val json = Json { ignoreUnknownKeys = true }
    private val client by lazy {
        val fingerprint = target.substringAfter('#', "").split('&')
            .firstOrNull { it.startsWith("fingerprint=") }
            ?.substringAfter('=')
            ?.lowercase()
        if (fingerprint != null && !fingerprint.matches(Regex("[a-f0-9]{64}"))) {
            error("Invalid pinned certificate fingerprint")
        }
        if (fingerprint == null) platformWebSocketHttpClient()
        else pinnedWebSocketHttpClient(fingerprint)
    }
    private val eglBase = EglBase.create()
    private var factory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var signalingJob: Job? = null
    private var statsJob: Job? = null
    @Volatile private var signaling: DefaultClientWebSocketSession? = null
    private var inputChannel: DataChannel? = null
    private var sequence = 1L
    private var renderer: SurfaceViewRenderer? = null
    private var remoteVideoTrack: VideoTrack? = null
    private var stopped = false
    private var remoteDescriptionSet = false
    private val pendingCandidates = mutableListOf<IceCandidate>()
    private val signalingRetry = SignalingRetry()
    private val signalingNetworkLabel = if (target.isPrivateNetworkTarget()) "局域网" else "公网/中继"
    private var lastStatsTotals: RemoteStreamStats.FrameTotals? = null
    @Volatile private var directlyConnected = false
    private val _captureMessage = MutableStateFlow<String?>(Str.remoteCaptureWaiting)
    val captureMessage: StateFlow<String?> = _captureMessage.asStateFlow()
    private val _connectionDetails = MutableStateFlow<String?>(null)
    val connectionDetails: StateFlow<String?> = _connectionDetails.asStateFlow()
    private val _streamStats = MutableStateFlow<RemoteStreamStats?>(null)
    val streamStats: StateFlow<RemoteStreamStats?> = _streamStats.asStateFlow()
    private val _textInputSupported = MutableStateFlow(false)
    val textInputSupported: StateFlow<Boolean> = _textInputSupported.asStateFlow()

    fun createRenderer(): SurfaceViewRenderer = SurfaceViewRenderer(context).also {
        renderer = it
        it.init(eglBase.eglBaseContext, null)
        it.setEnableHardwareScaler(true)
        it.setScalingType(org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        remoteVideoTrack?.addSink(it)
    }

    fun start() {
        if (signalingJob != null) return
        stopped = false
        signalingJob = scope.launch { run() }
    }

    fun stop() {
        if (stopped) return
        stopped = true
        _textInputSupported.value = false
        signalingJob?.cancel()
        signalingJob = null
        statsJob?.cancel()
        statsJob = null
        _streamStats.value = null
        inputChannel?.dispose()
        peerConnection?.dispose()
        factory?.dispose()
        signaling?.cancel()
        renderer?.let { remoteVideoTrack?.removeSink(it) }
        remoteVideoTrack = null
        renderer?.release()
        eglBase.release()
        client.close()
        scope.cancel()
    }

    fun pauseRenderer() = renderer?.pauseVideo()

    fun resumeRenderer() = renderer?.disableFpsReduction()

    fun sendPointer(type: String, x: Float, y: Float, button: String? = null, action: String? = null) {
        sendInput(buildJsonObject {
            put("type", type)
            put("sequence", sequence++)
            put("x", x.coerceIn(0f, 1f))
            put("y", y.coerceIn(0f, 1f))
            if (button != null) put("button", button)
            if (action != null) put("action", action)
        })
    }

    fun sendScroll(deltaX: Float, deltaY: Float) {
        sendInput(buildJsonObject {
            put("type", "pointer.scroll")
            put("sequence", sequence++)
            put("deltaX", deltaX)
            put("deltaY", deltaY)
        })
    }

    fun sendKey(code: String, action: String) {
        sendInput(buildJsonObject {
            put("type", "key")
            put("sequence", sequence++)
            put("code", code)
            put("action", action)
        })
    }

    fun sendText(text: String) {
        if (text.isBlank()) return
        sendInput(buildJsonObject {
            put("type", "text")
            put("sequence", sequence++)
            put("text", text.take(256))
        })
    }

    private fun sendInput(payload: JsonObject) {
        val channel = inputChannel ?: return
        if (channel.state() != DataChannel.State.OPEN) return
        channel.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(payload.toString().toByteArray()), false))
    }

    private suspend fun run() {
        try {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions(),
            )
            factory = PeerConnectionFactory.builder()
                .setVideoDecoderFactory(org.webrtc.DefaultVideoDecoderFactory(eglBase.eglBaseContext))
                .setVideoEncoderFactory(org.webrtc.DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
                .createPeerConnectionFactory()
            val (socketUrl, token) = splitTarget(target)
            while (!stopped) {
                try {
                    _connectionDetails.value = if (peerConnection == null) "正在连接${signalingNetworkLabel}信令…" else "正在恢复${signalingNetworkLabel}信令…"
                    val socket = client.webSocketSession {
                        url.takeFrom(socketUrl)
                        headers.append(HttpHeaders.SecWebSocketProtocol, listOf("vetta.desktop.v1", "vetta.pairing.$token").joinToString(", "))
                    }
                    signaling = socket
                    signalingRetry.reopened()
                    _connectionDetails.value = "${signalingNetworkLabel}信令已连接"
                    PlatformRemoteLogger.info("native WebRTC signaling connected")
                    if (peerConnection == null) createPeerConnection()
                    for (frame in socket.incoming) if (frame is Frame.Text) handleSignal(frame.readText())
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Throwable) {
                    if (stopped || !directlyConnected) throw error
                    val detail = safeConnectionDetail(error)
                    _connectionDetails.value = "信令暂时断开，屏幕直连保持中：$detail"
                    PlatformRemoteLogger.warn("native WebRTC signaling lost", mapOf("error" to detail))
                }
                signaling?.cancel()
                signaling = null
                if (stopped) break
                when (val drop = signalingRetry.dropped(directlyConnected)) {
                    SignalingDrop.Stop -> {
                        if (_captureMessage.value == Str.remoteCaptureWaiting) {
                            _captureMessage.value = Str.remoteCaptureUnavailable
                            _connectionDetails.value = "${signalingNetworkLabel}信令已断开，屏幕直连尚未建立"
                        }
                        break
                    }
                    is SignalingDrop.Reconnect -> {
                        _connectionDetails.value = "屏幕直连正常，${drop.afterMs / 1_000} 秒后重试局域网信令"
                        delay(drop.afterMs)
                    }
                }
            }
        } catch (error: Throwable) {
            if (!stopped) {
                _captureMessage.value = Str.remoteCaptureUnavailable
                val detail = safeConnectionDetail(error)
                _connectionDetails.value = "${signalingNetworkLabel}远程连接失败：$detail"
                PlatformRemoteLogger.warn("native WebRTC session failed", mapOf("error" to detail))
            }
        }
    }

    private fun createPeerConnection() {
        val configuration = PeerConnection.RTCConfiguration(listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
        ))
        configuration.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        peerConnection = factory?.createPeerConnection(configuration, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                PlatformRemoteLogger.info("native WebRTC ICE state", mapOf("state" to state.name))
                if (state == PeerConnection.IceConnectionState.CONNECTED || state == PeerConnection.IceConnectionState.COMPLETED) {
                    directlyConnected = true
                    _connectionDetails.value = "屏幕已通过 WebRTC 直连"
                    sampleStats()
                }
                if (state == PeerConnection.IceConnectionState.FAILED) {
                    directlyConnected = false
                    _captureMessage.value = Str.remoteCaptureFailed
                    if (signaling == null) scope.launch { stop() }
                }
                if (state == PeerConnection.IceConnectionState.CLOSED) {
                    directlyConnected = false
                    if (signaling == null) scope.launch { stop() }
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
            override fun onIceCandidate(candidate: IceCandidate) = sendSignal(candidateSignal(candidate))
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
            override fun onAddStream(stream: MediaStream) = Unit
            override fun onRemoveStream(stream: MediaStream) = Unit
            override fun onDataChannel(channel: DataChannel) {
                if (channel.label() != INPUT_CHANNEL || inputChannel != null) {
                    channel.dispose()
                    return
                }
                inputChannel = channel
                channel.registerObserver(object : DataChannel.Observer {
                    override fun onBufferedAmountChange(previousAmount: Long) = Unit
                    override fun onStateChange() = Unit
                    override fun onMessage(buffer: DataChannel.Buffer) {
                        if (buffer.binary) return
                        val bytes = ByteArray(buffer.data.remaining())
                        buffer.data.get(bytes)
                        val message = runCatching { json.parseToJsonElement(bytes.decodeToString()).jsonObject }.getOrNull() ?: return
                        if (message["type"]?.jsonPrimitive?.contentOrNull == "capabilities") {
                            _textInputSupported.value = message["textInput"]?.jsonPrimitive?.contentOrNull == "true"
                        }
                    }
                })
            }
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {
                val track = receiver.track() as? VideoTrack ?: return
                remoteVideoTrack = track
                renderer?.let(track::addSink)
                _captureMessage.value = null
                PlatformRemoteLogger.info("native WebRTC video track attached")
            }
        })
    }

    private fun handleSignal(raw: String) {
        for (line in raw.split('\n').filter { it.isNotBlank() }) {
            val signal = json.parseToJsonElement(line).jsonObject
            when (signal["type"]?.jsonPrimitive?.contentOrNull) {
                "offer" -> {
                    val sdp = signal["sdp"]?.jsonPrimitive?.content ?: return
                    PlatformRemoteLogger.info("native WebRTC offer received")
                    peerConnection?.setRemoteDescription(object : SdpObserver by LoggingSdpObserver {
                        override fun onSetSuccess() {
                            PlatformRemoteLogger.info("native WebRTC remote description set")
                            remoteDescriptionSet = true
                            pendingCandidates.forEach { peerConnection?.addIceCandidate(it) }
                            pendingCandidates.clear()
                            peerConnection?.createAnswer(object : SdpObserver by LoggingSdpObserver {
                                override fun onCreateSuccess(description: SessionDescription) {
                                    peerConnection?.setLocalDescription(object : SdpObserver by LoggingSdpObserver {
                                        override fun onSetSuccess() {
                                            PlatformRemoteLogger.info("native WebRTC local description set")
                                            sendSignal(buildJsonObject {
                                                put("type", "answer")
                                                put("protocolVersion", PROTOCOL_VERSION)
                                                put("sessionId", sessionId())
                                                put("sdp", description.description)
                                            })
                                            PlatformRemoteLogger.info("native WebRTC answer sent")
                                        }
                                    }, description)
                                }
                            }, MediaConstraints())
                        }
                    }, SessionDescription(SessionDescription.Type.OFFER, sdp))
                }
                "ice" -> {
                    val candidate = IceCandidate(
                        signal["sdpMid"]?.jsonPrimitive?.contentOrNull,
                        signal["sdpMLineIndex"]?.jsonPrimitive?.int ?: 0,
                        signal["candidate"]?.jsonPrimitive?.content ?: return,
                    )
                    if (remoteDescriptionSet) peerConnection?.addIceCandidate(candidate) else pendingCandidates += candidate
                }
                "end" -> {
                    _captureMessage.value = when (signal["reason"]?.jsonPrimitive?.contentOrNull) {
                        "completed" -> Str.remoteCaptureCompleted
                        "revoked" -> Str.remoteCaptureRevoked
                        "capture_denied" -> Str.remoteCaptureDenied
                        "capture_unavailable" -> Str.remoteCaptureUnavailable
                        "peer_closed" -> Str.remoteCapturePeerClosed
                        else -> Str.remoteCaptureFailed
                    }
                }
            }
        }
    }

    private fun sendSignal(signal: JsonObject) {
        scope.launch {
            val active = signaling ?: return@launch
            runCatching { active.send(Frame.Text(signal.toString() + "\n")) }
                .onFailure { error ->
                    if (!stopped) {
                        val detail = safeConnectionDetail(error)
                        _connectionDetails.value = "局域网信令发送失败，正在恢复：$detail"
                        PlatformRemoteLogger.warn(
                            "native WebRTC signal send failed",
                            mapOf("type" to signal["type"]?.jsonPrimitive?.contentOrNull, "error" to detail),
                        )
                        if (signaling === active) active.cancel()
                    }
                }
        }
    }

    private fun sampleStats() {
        if (statsJob?.isActive == true) return
        statsJob = scope.launch {
            while (!stopped) {
                val peer = peerConnection ?: break
                val report = CompletableDeferred<List<RemoteStreamStats.Entry>>()
                peer.getStats { stats ->
                    report.complete(stats.statsMap.values.map { stat ->
                        RemoteStreamStats.Entry(stat.id, stat.type, stat.members)
                    })
                }
                val (next, totals) = RemoteStreamStats.read(report.await(), lastStatsTotals)
                lastStatsTotals = totals
                _streamStats.value = next
                delay(1_000)
            }
        }
    }

    private fun safeConnectionDetail(error: Throwable): String {
        val raw = error.message?.takeIf(String::isNotBlank) ?: error::class.simpleName.orEmpty()
        val withoutTarget = raw.replace(target, target.substringBefore('#'))
        return withoutTarget
            .replace(Regex("(?i)(pairing|resume|bootstrap|fingerprint)=([^&\\s]+)"), "$1=[redacted]")
            .take(240)
    }

    private fun String.isPrivateNetworkTarget(): Boolean {
        val host = runCatching { android.net.Uri.parse(substringBefore('#')).host?.lowercase() }.getOrNull()
            ?: return false
        if (host == "localhost" || host.endsWith(".local") || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) {
            return true
        }
        val octets = host.split('.').mapNotNull(String::toIntOrNull)
        return octets.size == 4 && octets[0] == 172 && octets[1] in 16..31
    }

    private fun candidateSignal(candidate: IceCandidate) = buildJsonObject {
        put("type", "ice")
        put("protocolVersion", PROTOCOL_VERSION)
        put("sessionId", sessionId())
        put("candidate", candidate.sdp)
        candidate.sdpMid?.let { put("sdpMid", it) }
        put("sdpMLineIndex", candidate.sdpMLineIndex)
    }

    private fun sessionId(): String = Regex("/v1/desktop/([A-Za-z0-9_-]{24,128})/").find(target)?.groupValues?.get(1).orEmpty()

    private fun splitTarget(value: String): Pair<String, String> {
        val index = value.indexOf('#')
        if (index < 0) return value to ""
        val fragment = value.substring(index + 1)
        val token = if (fragment.contains('=')) android.net.Uri.decode(fragment.substringAfter("pairing=").substringBefore('&')) else fragment
        return value.substring(0, index) to token
    }

    private object LoggingSdpObserver : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) = Unit
        override fun onSetSuccess() = Unit
        override fun onCreateFailure(error: String) { PlatformRemoteLogger.warn("native WebRTC SDP create failed", mapOf("error" to error)) }
        override fun onSetFailure(error: String) { PlatformRemoteLogger.warn("native WebRTC SDP set failed", mapOf("error" to error)) }
    }
}
