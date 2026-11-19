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
import kotlinx.coroutines.isActive
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
import org.agent567.android.domain.remote.RemoteVideoSize
import org.agent567.android.domain.remote.RemoteStreamStats
import org.agent567.android.domain.remote.RemoteScreenStage
import org.agent567.android.domain.remote.RemoteVideoPreference
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
private const val ICE_DISCONNECT_GRACE_MS = 12_000L

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
    private var iceDisconnectJob: Job? = null
    @Volatile private var signaling: DefaultClientWebSocketSession? = null
    private var inputChannel: DataChannel? = null
    private val inputStateLock = Any()
    private val activeKeys = linkedSetOf<String>()
    private val activeMouseButtons = linkedMapOf<String, Pair<Float, Float>>()
    private val pendingKeyReleases = linkedSetOf<String>()
    private val pendingMouseReleases = linkedMapOf<String, Pair<Float, Float>>()
    private val sequence = java.util.concurrent.atomic.AtomicLong(1)
    @Volatile private var viewportSupported = false
    @Volatile private var viewportSize: Pair<Int, Int>? = null
    private var viewportJob: Job? = null
    private var renderer: SurfaceViewRenderer? = null
    private var remoteVideoTrack: VideoTrack? = null
    @Volatile private var stopped = false
    private var remoteDescriptionSet = false
    private val pendingCandidates = mutableListOf<IceCandidate>()
    private val signalingRetry = SignalingRetry()
    private val signalingNetworkLabel = if (target.isPrivateNetworkTarget()) "局域网" else "公网/中继"
    private var lastStatsTotals: RemoteStreamStats.FrameTotals? = null
    @Volatile private var directlyConnected = false
    private val _relativePointer = MutableStateFlow(false)
    val relativePointer: StateFlow<Boolean> = _relativePointer.asStateFlow()
    private var mediaConnected = false
    private var hostGrantedInput = false
    private val _inputEnabled = MutableStateFlow(false)
    private fun refreshInputAvailability() {
        _inputEnabled.value = !stopped && mediaConnected && hostGrantedInput && _hasVideoFrame.value
        if (_inputEnabled.value) flushPendingReleases()
    }
    val inputEnabled: StateFlow<Boolean> = _inputEnabled.asStateFlow()
    private val _captureMessage = MutableStateFlow<String?>(Str.remoteCaptureWaiting)
    val captureMessage: StateFlow<String?> = _captureMessage.asStateFlow()
    private val _reconnectingMessage = MutableStateFlow<String?>(null)
    val reconnectingMessage: StateFlow<String?> = _reconnectingMessage.asStateFlow()
    private val _connectionDetails = MutableStateFlow<String?>(null)
    val connectionDetails: StateFlow<String?> = _connectionDetails.asStateFlow()
    private val _streamStats = MutableStateFlow<RemoteStreamStats?>(null)
    val streamStats: StateFlow<RemoteStreamStats?> = _streamStats.asStateFlow()
    private val _stage = MutableStateFlow(RemoteScreenStage.Connecting)
    val stage: StateFlow<RemoteScreenStage> = _stage.asStateFlow()
    private val _videoPreferenceSupported = MutableStateFlow(false)
    val videoPreferenceSupported: StateFlow<Boolean> = _videoPreferenceSupported.asStateFlow()
    private var preferredVideo = RemoteVideoPreference.Auto
    private val _textInputSupported = MutableStateFlow(false)
    val textInputSupported: StateFlow<Boolean> = _textInputSupported.asStateFlow()

    private val _hasVideoFrame = MutableStateFlow(false)
    val hasVideoFrame: StateFlow<Boolean> = _hasVideoFrame.asStateFlow()
    private val _videoSize = MutableStateFlow<RemoteVideoSize?>(null)
    val videoSize: StateFlow<RemoteVideoSize?> = _videoSize.asStateFlow()

    fun createRenderer(): SurfaceViewRenderer = SurfaceViewRenderer(context).also {
        renderer?.let(::releaseRenderer)
        renderer = it
        it.init(eglBase.eglBaseContext, object : org.webrtc.RendererCommon.RendererEvents {
            override fun onFirstFrameRendered() {
                val view = it
                scope.launch {
                    if (!stopped && renderer === view) {
                        _hasVideoFrame.value = true
                        refreshInputAvailability()
                        if (_stage.value != RemoteScreenStage.Reconnecting) _stage.value = RemoteScreenStage.Receiving
                        if (_captureMessage.value == Str.remoteCaptureWaiting) _captureMessage.value = null
                    }
                }
            }
            override fun onFrameResolutionChanged(width: Int, height: Int, rotation: Int) {
                val view = it
                scope.launch {
                    if (!stopped && renderer === view) {
                        _videoSize.value = if (rotation % 180 == 0) RemoteVideoSize(width, height) else RemoteVideoSize(height, width)
                    }
                }
            }
        })
        it.setEnableHardwareScaler(false)
        it.setScalingType(org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        remoteVideoTrack?.addSink(it)
    }

    fun releaseRenderer(view: SurfaceViewRenderer) {
        if (renderer !== view) return
        remoteVideoTrack?.removeSink(view)
        renderer = null
        view.release()
    }

    fun start() {
        if (stopped || signalingJob != null) return
        signalingJob = scope.launch { run() }
    }

    fun stop() {
        if (stopped) return
        releaseAllInputs()
        stopped = true
        _stage.value = RemoteScreenStage.Ended
        _videoPreferenceSupported.value = false
        clearTrackedInputs()
        directlyConnected = false
        viewportSupported = false
        viewportJob?.cancel()
        iceDisconnectJob?.cancel()
        iceDisconnectJob = null
        _reconnectingMessage.value = null
        _textInputSupported.value = false
        _relativePointer.value = false
        _inputEnabled.value = false
        signalingJob?.cancel()
        signalingJob = null
        statsJob?.cancel()
        statsJob = null
        _streamStats.value = null
        _hasVideoFrame.value = false
        _videoSize.value = null
        renderer?.let(::releaseRenderer)
        remoteVideoTrack = null
        val channel = inputChannel
        inputChannel = null
        channel?.unregisterObserver()
        channel?.dispose()
        val peer = peerConnection
        peerConnection = null
        peer?.dispose()
        factory?.dispose()
        factory = null
        signaling?.cancel()
        eglBase.release()
        client.close()
        scope.cancel()
    }

    fun pauseRenderer() {
        releaseAllInputs()
        renderer?.pauseVideo()
    }

    fun resumeRenderer() = renderer?.disableFpsReduction()

    fun updateViewport(width: Int, height: Int) {
        if (width <= 0 || height <= 0) return
        val size = width.coerceAtMost(8192) to height.coerceAtMost(8192)
        if (viewportSize == size) return
        viewportSize = size
        scheduleViewport()
    }

    fun preferVideo(mode: RemoteVideoPreference): Boolean {
        preferredVideo = mode
        if (!_videoPreferenceSupported.value || stopped) return false
        val channel = inputChannel ?: return false
        return runCatching {
        if (channel.state() != DataChannel.State.OPEN) return@runCatching false
        val payload = buildJsonObject {
            put("type", "video.preference"); put("sequence", sequence.getAndIncrement()); put("mode", mode.wire)
        }
        channel.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(payload.toString().toByteArray()), false))
        }.getOrDefault(false)
    }

    private fun scheduleViewport() {
        viewportJob?.cancel()
        if (!viewportSupported || stopped) return
        viewportJob = scope.launch {
            delay(150) // Coalesce pinch and layout changes; each encoder resize costs a full frame.
            val size = viewportSize ?: return@launch
            if (!viewportSupported || stopped) return@launch
            val channel = inputChannel ?: return@launch
            if (channel.state() != DataChannel.State.OPEN) return@launch
            val payload = buildJsonObject {
                put("type", "viewport"); put("sequence", sequence.getAndIncrement())
                put("width", size.first); put("height", size.second)
            }
            channel.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(payload.toString().toByteArray()), false))
        }
    }

    fun sendPointer(type: String, x: Float, y: Float, button: String? = null, action: String? = null) {
        val clampedX = x.coerceIn(0f, 1f)
        val clampedY = y.coerceIn(0f, 1f)
        if (type == "pointer.button" && button != null) {
            when (action) {
                "down" -> {
                    val pendingPos = synchronized(inputStateLock) { pendingMouseReleases.remove(button) }
                    if (pendingPos != null && !sendPointerButton(button, pendingPos.first, pendingPos.second, "up")) {
                        synchronized(inputStateLock) { pendingMouseReleases[button] = pendingPos }
                        return
                    }
                    val sent = sendPointerButton(button, clampedX, clampedY, "down")
                    if (sent) {
                        synchronized(inputStateLock) { activeMouseButtons[button] = clampedX to clampedY }
                    }
                    return
                }
                "up" -> {
                    val wasTracked = synchronized(inputStateLock) {
                        activeMouseButtons.remove(button) != null || pendingMouseReleases.containsKey(button)
                    }
                    val sent = sendPointerButton(button, clampedX, clampedY, "up")
                    synchronized(inputStateLock) {
                        if (sent) {
                            activeMouseButtons.remove(button)
                            pendingMouseReleases.remove(button)
                        } else if (wasTracked) {
                            pendingMouseReleases[button] = clampedX to clampedY
                        }
                    }
                    return
                }
            }
        }
        val sent = sendInput(buildJsonObject {
            put("type", type)
            put("sequence", sequence.getAndIncrement())
            put("x", clampedX)
            put("y", clampedY)
            if (button != null) put("button", button)
            if (action != null) put("action", action)
        })
        if (type == "pointer.move" && sent) {
            synchronized(inputStateLock) {
                if (activeMouseButtons.isNotEmpty()) {
                    val pos = clampedX to clampedY
                    activeMouseButtons.keys.forEach { activeMouseButtons[it] = pos }
                }
            }
        }
    }

    fun sendRelativePointer(deltaX: Float, deltaY: Float) {
        if (!_relativePointer.value) return
        sendInput(buildJsonObject {
            put("type", "pointer.relative"); put("sequence", sequence.getAndIncrement())
            put("deltaX", deltaX.coerceIn(-4096f, 4096f)); put("deltaY", deltaY.coerceIn(-4096f, 4096f))
        })
    }

    fun sendScroll(deltaX: Float, deltaY: Float) {
        sendInput(buildJsonObject {
            put("type", "pointer.scroll")
            put("sequence", sequence.getAndIncrement())
            put("deltaX", deltaX)
            put("deltaY", deltaY)
        })
    }

    fun sendKey(code: String, action: String) {
        when (action) {
            "down" -> {
                val hadPending = synchronized(inputStateLock) { pendingKeyReleases.remove(code) }
                if (hadPending && !sendKeyEvent(code, "up")) {
                    synchronized(inputStateLock) { pendingKeyReleases += code }
                    return
                }
                val sent = sendKeyEvent(code, "down")
                if (sent) {
                    synchronized(inputStateLock) { activeKeys += code }
                }
            }
            "up" -> {
                val wasTracked = synchronized(inputStateLock) {
                    activeKeys.remove(code) || pendingKeyReleases.contains(code)
                }
                val sent = sendKeyEvent(code, "up")
                synchronized(inputStateLock) {
                    if (sent) {
                        activeKeys.remove(code)
                        pendingKeyReleases.remove(code)
                    } else if (wasTracked) {
                        pendingKeyReleases += code
                    }
                }
            }
            else -> sendKeyEvent(code, action)
        }
    }

    fun sendText(text: String): Boolean {
        if (text.isBlank() || text.length > 256 || !_textInputSupported.value) return false
        return sendInput(buildJsonObject {
            put("type", "text")
            put("sequence", sequence.getAndIncrement())
            put("text", text)
        })
    }

    fun releaseAllInputs() {
        synchronized(inputStateLock) {
            activeMouseButtons.forEach { (button, pos) -> pendingMouseReleases[button] = pos }
            activeMouseButtons.clear()
            pendingKeyReleases += activeKeys
            activeKeys.clear()
        }
        flushPendingReleases()
    }

    private fun flushPendingReleases() {
        if (stopped) return
        val buttonsToRelease: List<Pair<String, Pair<Float, Float>>>
        val keysToRelease: List<String>
        synchronized(inputStateLock) {
            if (pendingMouseReleases.isEmpty() && pendingKeyReleases.isEmpty()) return
            buttonsToRelease = pendingMouseReleases.entries.map { it.key to it.value }
            keysToRelease = pendingKeyReleases.toList()
        }
        buttonsToRelease.forEach { (button, pos) ->
            if (sendPointerButton(button, pos.first, pos.second, "up")) {
                synchronized(inputStateLock) {
                    if (pendingMouseReleases[button] == pos) pendingMouseReleases.remove(button)
                }
            }
        }
        keysToRelease.forEach { code ->
            if (sendKeyEvent(code, "up")) {
                synchronized(inputStateLock) {
                    pendingKeyReleases.remove(code)
                }
            }
        }
    }

    private fun sendPointerButton(button: String, x: Float, y: Float, action: String): Boolean = sendInput(buildJsonObject {
        put("type", "pointer.button")
        put("sequence", sequence.getAndIncrement())
        put("x", x.coerceIn(0f, 1f))
        put("y", y.coerceIn(0f, 1f))
        put("button", button)
        put("action", action)
    })

    private fun sendKeyEvent(code: String, action: String): Boolean = sendInput(buildJsonObject {
        put("type", "key")
        put("sequence", sequence.getAndIncrement())
        put("code", code)
        put("action", action)
    })

    private fun clearTrackedInputs() {
        synchronized(inputStateLock) {
            activeMouseButtons.clear()
            activeKeys.clear()
            pendingMouseReleases.clear()
            pendingKeyReleases.clear()
        }
    }

    private fun sendInput(payload: JsonObject): Boolean {
        if (stopped) return false
        if (!_inputEnabled.value && payload["type"]?.jsonPrimitive?.contentOrNull != "heartbeat") return false
        val channel = inputChannel ?: return false
        if (channel.state() != DataChannel.State.OPEN) return false
        return runCatching {
            channel.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(payload.toString().toByteArray()), false))
        }.getOrDefault(false)
    }

    private suspend fun run() {
        try {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(context).setFieldTrials("WebRTC-ForcePlayoutDelay/min_ms:0,max_ms:0/").createInitializationOptions(),
            )
            factory = PeerConnectionFactory.builder()
                .setFieldTrials("WebRTC-ForcePlayoutDelay/min_ms:0,max_ms:0/")
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
                    signalingRetry.reopened(directlyConnected)
                    _connectionDetails.value = "${signalingNetworkLabel}信令已连接"
                    if (!_hasVideoFrame.value && !remoteDescriptionSet) _stage.value = RemoteScreenStage.WaitingForScreen
                    PlatformRemoteLogger.info("native WebRTC signaling connected")
                    if (peerConnection == null) createPeerConnection()
                    for (frame in socket.incoming) if (frame is Frame.Text) handleSignal(frame.readText())
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Throwable) {
                    if (stopped) return
                    val detail = safeConnectionDetail(error)
                    _connectionDetails.value = "${signalingNetworkLabel}信令暂时断开，正在恢复：$detail"
                    PlatformRemoteLogger.warn("native WebRTC signaling lost", mapOf("error" to detail))
                }
                signaling?.cancel()
                signaling = null
                if (stopped) break
                when (val drop = signalingRetry.dropped(directlyConnected)) {
                    SignalingDrop.Stop -> {
                        _captureMessage.value = Str.remoteCaptureFailed
                        _connectionDetails.value = "${signalingNetworkLabel}信令已断开，屏幕直连尚未建立"
                        stop()
                        break
                    }
                    is SignalingDrop.Reconnect -> {
                        if (!directlyConnected) _stage.value = RemoteScreenStage.Reconnecting
                        _connectionDetails.value = "${drop.afterMs / 1_000} 秒后重试${signalingNetworkLabel}信令"
                        delay(drop.afterMs)
                    }
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            if (!stopped) {
                _captureMessage.value = Str.remoteCaptureUnavailable
                val detail = safeConnectionDetail(error)
                _connectionDetails.value = "${signalingNetworkLabel}远程连接失败：$detail"
                PlatformRemoteLogger.warn("native WebRTC session failed", mapOf("error" to detail))
                stop()
            }
        } finally {
            signaling?.cancel()
            signaling = null
        }
    }

    private fun createPeerConnection() {
        val configuration = PeerConnection.RTCConfiguration(listOf(
            PeerConnection.IceServer.builder(listOf("stun:stun.miwifi.com:3478", "stun:stun.chat.bilibili.com:3478", "stun:stun.hitv.com:3478")).createIceServer(),
        ))
        configuration.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        peerConnection = factory?.createPeerConnection(configuration, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {
                scope.launch {
                    if (stopped) return@launch
                    PlatformRemoteLogger.info("native WebRTC ICE state", mapOf("state" to state.name))
                    when (state) {
                        PeerConnection.IceConnectionState.CONNECTED, PeerConnection.IceConnectionState.COMPLETED -> {
                            iceDisconnectJob?.cancel()
                            iceDisconnectJob = null
                            _reconnectingMessage.value = null
                            mediaConnected = true
                            _stage.value = if (_hasVideoFrame.value) RemoteScreenStage.Receiving else RemoteScreenStage.WaitingForFrame
                            directlyConnected = true
                            signalingRetry.reopened()
                            _connectionDetails.value = "屏幕已通过 WebRTC 直连"
                            refreshInputAvailability()
                            sampleStats()
                        }
                        PeerConnection.IceConnectionState.DISCONNECTED -> {
                            releaseAllInputs()
                            mediaConnected = false
                            refreshInputAvailability()
                            _reconnectingMessage.value = Str.remoteCaptureReconnecting
                            _stage.value = RemoteScreenStage.Reconnecting
                            _connectionDetails.value = Str.remoteCaptureReconnecting
                            if (iceDisconnectJob?.isActive != true) {
                                iceDisconnectJob = scope.launch {
                                    delay(ICE_DISCONNECT_GRACE_MS)
                                    if (!stopped && isActive) {
                                        _reconnectingMessage.value = null
                                        _captureMessage.value = Str.remoteCaptureFailed
                                        stop()
                                    }
                                }
                            }
                        }
                        PeerConnection.IceConnectionState.FAILED, PeerConnection.IceConnectionState.CLOSED -> {
                            iceDisconnectJob?.cancel()
                            iceDisconnectJob = null
                            _reconnectingMessage.value = null
                            _captureMessage.value = if (state == PeerConnection.IceConnectionState.FAILED) Str.remoteCaptureFailed else Str.remoteCapturePeerClosed
                            stop()
                        }
                        else -> Unit
                    }
                }
            }
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
            override fun onIceCandidate(candidate: IceCandidate) = sendSignal(candidateSignal(candidate))
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) = Unit
            override fun onAddStream(stream: MediaStream) = Unit
            override fun onRemoveStream(stream: MediaStream) = Unit
            override fun onDataChannel(channel: DataChannel) {
                scope.launch { attachInputChannel(channel) }
            }
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {
                val track = receiver.track() as? VideoTrack ?: return
                scope.launch {
                    if (stopped) return@launch
                    remoteVideoTrack = track
                    renderer?.let(track::addSink)
                    // Keep waiting until the renderer confirms the first frame.
                    PlatformRemoteLogger.info("native WebRTC video track attached")
                }
            }
        })
    }

    private fun handleSignal(raw: String) {
        for (line in raw.split('\n').filter { it.isNotBlank() }) {
            if (stopped) return
            val signal = json.parseToJsonElement(line).jsonObject
            when (signal["type"]?.jsonPrimitive?.contentOrNull) {
                "offer" -> {
                    _stage.value = RemoteScreenStage.Negotiating
                    val peer = peerConnection ?: return
                    val sdp = signal["sdp"]?.jsonPrimitive?.content ?: return
                    PlatformRemoteLogger.info("native WebRTC offer received")
                    peer.setRemoteDescription(object : SdpObserver by LoggingSdpObserver {
                        override fun onSetSuccess() = withActivePeer(peer) {
                            PlatformRemoteLogger.info("native WebRTC remote description set")
                            remoteDescriptionSet = true
                            pendingCandidates.forEach { peer.addIceCandidate(it) }
                            pendingCandidates.clear()
                            answerOffer(peer)
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
                    stop()
                }
            }
        }
    }

    private fun attachInputChannel(channel: DataChannel) {
        if (stopped || channel.label() != INPUT_CHANNEL || inputChannel != null) {
            channel.dispose()
            return
        }
        inputChannel = channel
        channel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) = Unit
            override fun onStateChange() {
                val state = channel.state()
                scope.launch {
                    if (stopped || inputChannel !== channel) return@launch
                    when (state) {
                        DataChannel.State.OPEN -> refreshInputAvailability()
                        DataChannel.State.CLOSED -> {
                            clearTrackedInputs()
                            hostGrantedInput = false
                            _inputEnabled.value = false
                            _relativePointer.value = false
                            _textInputSupported.value = false
                            viewportSupported = false
                            _videoPreferenceSupported.value = false
                        }
                        else -> Unit
                    }
                }
            }
            override fun onMessage(buffer: DataChannel.Buffer) {
                if (stopped || buffer.binary) return
                val bytes = ByteArray(buffer.data.remaining())
                buffer.data.get(bytes)
                scope.launch {
                    if (stopped || inputChannel !== channel) return@launch
                    val message = runCatching { json.parseToJsonElement(bytes.decodeToString()).jsonObject }.getOrNull() ?: return@launch
                    if (message["type"]?.jsonPrimitive?.contentOrNull != "capabilities") return@launch
                    viewportSupported = message["viewport"]?.jsonPrimitive?.contentOrNull == "true"
                    _videoPreferenceSupported.value = message["videoPreference"]?.jsonPrimitive?.contentOrNull == "true"
                    preferVideo(preferredVideo)
                    scheduleViewport()
                    _textInputSupported.value = message["textInput"]?.jsonPrimitive?.contentOrNull == "true"
                    _relativePointer.value = message["pointerMode"]?.jsonPrimitive?.contentOrNull == "relative"
                    // Older hosts enforce input permission at the OS adapter.
                    hostGrantedInput = message["inputEnabled"]?.jsonPrimitive?.contentOrNull != "false"
                    if (!hostGrantedInput) clearTrackedInputs()
                    refreshInputAvailability()
                }
            }
        })
    }

    private fun answerOffer(peer: PeerConnection) {
        peer.createAnswer(object : SdpObserver by LoggingSdpObserver {
            override fun onCreateSuccess(description: SessionDescription) = withActivePeer(peer) {
                peer.setLocalDescription(object : SdpObserver by LoggingSdpObserver {
                    override fun onSetSuccess() = withActivePeer(peer) {
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

    private fun withActivePeer(peer: PeerConnection, action: () -> Unit) {
        scope.launch { if (!stopped && peerConnection === peer) action() }
    }

    private fun sendSignal(signal: JsonObject) {
        if (stopped) return
        val active = signaling ?: return
        scope.launch {
            if (stopped || signaling !== active) return@launch
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
