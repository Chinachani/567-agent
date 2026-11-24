package org.agent567.android.ui.remote

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.agent567.android.app.ThemeMode
import org.agent567.android.domain.remote.RemoteScreenStage
import org.agent567.android.domain.remote.RemoteVideoPreference
import org.agent567.android.domain.remote.RemoteStreamStats
import org.agent567.android.domain.remote.RemotePointerInput
import org.agent567.android.domain.remote.RemotePointerPosition
import org.agent567.android.domain.remote.RemoteViewTransform
import org.agent567.android.domain.remote.transformRemoteView
import org.agent567.android.domain.remote.fitRemoteVideo
import org.agent567.android.domain.remote.followTrackpadCursor
import org.agent567.android.domain.remote.keyboardRemoteView
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.Agent567Theme
import kotlin.math.roundToInt

private enum class RemoteTyping { System, Draft }

@OptIn(ExperimentalLayoutApi::class)
@Composable
actual fun RemoteDesktopSurface(
    target: String,
    modifier: Modifier,
    onExit: () -> Unit,
    onStateChange: (RemotePreviewPhase) -> Unit,
) {
    val context = LocalContext.current
    // The session survives preview/fullscreen transitions; only the video sink moves.
    var attempt by remember(target) { mutableIntStateOf(0) }
    var exited by remember(target) { mutableStateOf(false) }
    val session = remember(target, attempt) { NativeRemoteDesktopSession(context.applicationContext, target) }
    val captureMessage by session.captureMessage.collectAsState()
    val reconnectingMessage by session.reconnectingMessage.collectAsState()
    val hasVideoFrame by session.hasVideoFrame.collectAsState()
    val stage by session.stage.collectAsState()
    var slowFirstFrame by remember(session) { mutableStateOf(false) }
    LaunchedEffect(session, stage, hasVideoFrame) {
        slowFirstFrame = false
        if (stage == RemoteScreenStage.WaitingForFrame && !hasVideoFrame) {
            kotlinx.coroutines.delay(8_000)
            slowFirstFrame = true
        }
    }
    val preferenceSupported by session.videoPreferenceSupported.collectAsState()
    val preferences = remember(context) { context.getSharedPreferences("remote-controls", android.content.Context.MODE_PRIVATE) }
    var videoPreference by remember { mutableStateOf(RemoteVideoPreference.entries.find { it.wire == preferences.getString("video-preference", "auto") } ?: RemoteVideoPreference.Auto) }
    var pointerSpeed by remember { mutableIntStateOf(preferences.getInt("pointer-speed-v1", 1).coerceIn(0, 2)) }
    var floatingMouse by remember { mutableStateOf(preferences.getBoolean("floating-mouse", true)) }
    var useDraft by remember { mutableStateOf(preferences.getBoolean("keyboard-use-draft", false)) }
    var connectionPanel by remember { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    var pasteFeedback by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(session) { session.preferVideo(videoPreference) }
    val stats by session.streamStats.collectAsState()
    val videoSize by session.videoSize.collectAsState()
    val textInputSupported by session.textInputSupported.collectAsState()
    val relativePointer by session.relativePointer.collectAsState()
    val inputEnabled by session.inputEnabled.collectAsState()
    val pointerInput = remember(session) {
        RemotePointerInput(
            sendPointer = { type, position, button, action -> session.sendPointer(type, position.x, position.y, button, action) },
            sendRelative = session::sendRelativePointer,
        )
    }
    var fullscreen by remember(target) { mutableStateOf(false) }
    var typing by remember(session) { mutableStateOf<RemoteTyping?>(null) }
    val keyboardOpen = typing != null
    var remoteText by remember(target) { mutableStateOf("") }
    var directTouch by rememberSaveable(target) { mutableStateOf(true) }
    var transform by remember(target) { mutableStateOf(RemoteViewTransform()) }
    var controlsBottomInsetPx by remember(typing) { mutableFloatStateOf(0f) }
    var manualKeyboardView by remember(typing) { mutableStateOf<RemoteViewTransform?>(null) }
    var fullscreenViewport by remember(target) { mutableStateOf(IntSize.Zero) }
    val effectiveBottomInsetPx = if (keyboardOpen) controlsBottomInsetPx else 0f
    val frameWidth = videoSize?.width ?: stats?.frameWidth
    val frameHeight = videoSize?.height ?: stats?.frameHeight
    val canvasTransform = if (!keyboardOpen) transform else manualKeyboardView?.let {
        transformRemoteView(it, 1f, 0f, 0f, 0f, 0f, fullscreenViewport.width, fullscreenViewport.height, frameWidth, frameHeight, effectiveBottomInsetPx)
    } ?: keyboardRemoteView(transform, fullscreenViewport.width, fullscreenViewport.height, frameWidth, frameHeight, effectiveBottomInsetPx)
    val textFocusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    LaunchedEffect(fullscreen, fullscreenViewport, frameWidth, frameHeight, effectiveBottomInsetPx) {
        if (fullscreen && fullscreenViewport.width > 0 && fullscreenViewport.height > 0) {
            transform = transformRemoteView(
                transform, 1f,
                fullscreenViewport.width / 2f, fullscreenViewport.height / 2f,
                0f, 0f,
                fullscreenViewport.width, fullscreenViewport.height,
                frameWidth, frameHeight,
                effectiveBottomInsetPx,
            )
        }
    }
    LaunchedEffect(inputEnabled, textInputSupported) {
        if (!inputEnabled) { pointerInput.resetButtons(); typing = null }
        if (!textInputSupported && typing == RemoteTyping.System) typing = null
    }
    fun releaseControls() { pointerInput.resetButtons(); session.releaseAllInputs() }
    DisposableEffect(session) { session.start(); onDispose { pointerInput.resetButtons(); session.stop() } }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(session, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START, Lifecycle.Event.ON_RESUME -> session.resumeRenderer()
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> {
                    releaseControls(); typing = null
                    session.pauseRenderer()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    fun closeFullscreen() { releaseControls(); typing = null; keyboardController?.hide(); fullscreen = false }
    fun retry() { session.stop(); exited = false; typing = null; controlsBottomInsetPx = 0f; transform = RemoteViewTransform(); attempt++ }
    fun exit() { closeFullscreen(); exited = true; session.stop(); onExit() }
    fun sendRemoteText() {
        if (remoteText.isBlank() || remoteText.length > 256 || !textInputSupported || !inputEnabled) return
        if (session.sendText(remoteText)) {
            remoteText = ""
        }
    }
    val visibleMessage = if (exited) Str.remoteExited else captureMessage
    val phase = remotePreviewPhase(visibleMessage, hasVideoFrame)
    val reportState by rememberUpdatedState(onStateChange)
    LaunchedEffect(phase) { reportState(phase) }

    RemoteDesktopPreview(
        phase = phase,
        message = visibleMessage,
        modifier = modifier,
        latency = stats?.roundTripMs?.let { "${it.roundToInt()} ms" },
        reconnectingMessage = reconnectingMessage,
        waitingMessage = stage.label(),
        slowFirstFrame = slowFirstFrame,
        onDiagnostics = { connectionPanel = true },
        onRetry = ::retry,
        onClose = ::exit,
        onFullscreen = { transform = RemoteViewTransform(); fullscreen = true },
    ) {
        if (!fullscreen) key(session) {
            RemoteCanvas(session, stats, false, null, Modifier.fillMaxSize(), pointerInput = pointerInput)
        } else Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(Str.remoteDesktopFullscreen)
        }
    }
    if (connectionPanel && !fullscreen) RemoteConnectionPanel(stage, stats, inputEnabled, videoPreference, preferenceSupported,
        onPreference = {
            videoPreference = it
            preferences.edit().putString("video-preference", it.wire).apply()
            session.preferVideo(it)
        }, onReconnect = ::retry, onDismiss = { connectionPanel = false })
    if (fullscreen) {
        val resetPositions = rememberResetRemoteOverlayPositions()
        var layoutRevision by remember { mutableIntStateOf(0) }
        var showKeyboardEntry by rememberSaveable { mutableStateOf(true) }
        val isPhone = LocalConfiguration.current.smallestScreenWidthDp < 600
        val remotePortrait = frameWidth != null && frameHeight != null && frameHeight > frameWidth
        RemoteFullscreenOrientation(lockLandscape = isPhone && !remotePortrait)
        fun closeKeyboard() { releaseControls(); typing = null }
        fun openKeyboard() {
            releaseControls()
            pasteFeedback = null
            typing = if (useDraft || !textInputSupported) RemoteTyping.Draft else RemoteTyping.System
        }
        Dialog(onDismissRequest = { if (keyboardOpen) closeKeyboard() else closeFullscreen() }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        RemoteImmersiveWindow()
        val dialogKeyboard = LocalSoftwareKeyboardController.current
        val imeHeight = WindowInsets.ime.getBottom(LocalDensity.current)
        val imeVisible = WindowInsets.isImeVisible
        var seenIme by remember(typing) { mutableStateOf(false) }
        LaunchedEffect(typing, imeHeight, imeVisible) {
            if (typing == RemoteTyping.System && controlsBottomInsetPx < imeHeight.toFloat()) {
                controlsBottomInsetPx = imeHeight.toFloat()
            }
            if (keyboardOpen && imeVisible) seenIme = true
            if (keyboardOpen && seenIme && !imeVisible) closeKeyboard()
        }
        LaunchedEffect(typing) {
            if (typing == RemoteTyping.Draft) {
                textFocusRequester.requestFocus()
                dialogKeyboard?.show()
            } else if (typing == null) dialogKeyboard?.hide()
        }
        if (connectionPanel) RemoteConnectionPanel(stage, stats, inputEnabled, videoPreference, preferenceSupported,
            onPreference = {
                videoPreference = it
                preferences.edit().putString("video-preference", it.wire).apply()
                session.preferVideo(it)
            }, onReconnect = ::retry, onDismiss = { connectionPanel = false })
        Surface(Modifier.fillMaxSize(), color = Color.Black) {
            RemoteFullscreenLayout(
                layoutRevision = layoutRevision,
                keyboardOpen = keyboardOpen,
                draftOpen = typing == RemoteTyping.Draft,
                onDraftOcclusion = { controlsBottomInsetPx = it },
                video = {
                    key(session) {
                        RemoteCanvas(
                            session = session,
                            stats = stats,
                            interactive = true,
                            message = visibleMessage,
                            modifier = Modifier.fillMaxSize(),
                            transform = canvasTransform,
                            onTransform = { if (it != canvasTransform) { if (keyboardOpen) manualKeyboardView = it else transform = it } },
                            relativePointer = relativePointer,
                            directTouch = directTouch, pointerSpeed = pointerSpeed,
                            editingText = keyboardOpen,
                            showCursor = floatingMouse && inputEnabled,
                            onRetry = ::retry,
                            onExit = ::exit,
                            pointerInput = pointerInput,
                            bottomInsetPx = effectiveBottomInsetPx,
                            onViewportSize = { fullscreenViewport = it },
                        )
                    }
                },
                toolbar = { handle ->
                    RemoteFullscreenToolbar(
                    relativePointer = relativePointer, directTouch = directTouch, canReset = transform != RemoteViewTransform(),
                    stats = buildList { if (!inputEnabled) add(Str.viewOnly); stats?.roundTripMs?.let { add("${it.roundToInt()} ms") }; stats?.framesPerSecond?.let { add("${it.roundToInt()} FPS") } }.joinToString(" · ").ifBlank { Str.connectionStatus },
                    details = stage.label(), onExit = ::closeFullscreen,
                    onDirectTouch = { releaseControls(); directTouch = it }, onReset = { transform = RemoteViewTransform() },
                    onKeyboard = ::openKeyboard,
                    useDraft = useDraft, onUseDraft = { useDraft = it; preferences.edit().putBoolean("keyboard-use-draft", it).apply() },
                    textAvailable = textInputSupported, handleModifier = handle, showMouse = floatingMouse,
                    onResetPositions = { resetPositions(); layoutRevision++ }, showKeyboardEntry = showKeyboardEntry,
                    onToggleKeyboardEntry = { showKeyboardEntry = !showKeyboardEntry },
                    onShowMouse = { floatingMouse = it; preferences.edit().putBoolean("floating-mouse", it).apply() },
                    pointerSpeed = pointerSpeed, onPointerSpeed = { pointerSpeed = it; preferences.edit().putInt("pointer-speed-v1", it).apply() },
                    onMouseButton = pointerInput::click, onMouseHold = pointerInput::hold,
                    inputEnabled = inputEnabled,
                    onConnectionPanel = { connectionPanel = true },
                    modifier = Modifier,
                    )
                },
                mouse = { grip ->
                    if (floatingMouse && inputEnabled) RemoteFloatingMouse(grip, pointerInput::click, pointerInput::hold) { session.sendScroll(0f, it) }
                },
                keyboard = { grip -> if (inputEnabled && showKeyboardEntry) RemoteFloatingKeyboard(grip, ::openKeyboard) },
                banner = {
                    if (reconnectingMessage != null && visibleMessage == null) {
                        Agent567Theme(ThemeMode.Dark) {
                            Surface(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                                shape = MaterialTheme.shapes.large,
                                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.92f),
                            ) {
                                Row(
                                    Modifier.padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                                    Text(reconnectingMessage ?: "", style = MaterialTheme.typography.bodySmall, maxLines = 2)
                                    TextButton(onClick = ::retry, modifier = Modifier.heightIn(min = 48.dp)) {
                                        Text(Str.remoteReconnect, maxLines = 1)
                                    }
                                }
                            }
                        }
                    }
                },
                controls = { grip ->
                    if (typing == RemoteTyping.System && inputEnabled && textInputSupported) {
                        RemoteDirectTyping(
                            onText = { typing == RemoteTyping.System && session.sendText(it) },
                            onKey = { code, action -> if (typing == RemoteTyping.System || action == "up") session.sendKey(code, action) },
                            onDismiss = { closeKeyboard(); dialogKeyboard?.hide() }, grip = grip,
                        )
                    } else if (typing == RemoteTyping.Draft) Surface(color = MaterialTheme.colorScheme.surface) {
                        val shiftedTransform = transformRemoteView(
                            canvasTransform, 1f,
                            fullscreenViewport.width / 2f, fullscreenViewport.height / 2f,
                            0f, -effectiveBottomInsetPx,
                            fullscreenViewport.width, fullscreenViewport.height,
                            frameWidth, frameHeight,
                            effectiveBottomInsetPx,
                        )
                        val isShiftedForKeyboard = canvasTransform.panY < transform.panY - 1f
                        val canShiftForKeyboard = effectiveBottomInsetPx > 0f && shiftedTransform.panY < canvasTransform.panY - 1f
                        var toolsOpen by remember { mutableStateOf(false) }
                        Column {
                            if (toolsOpen) Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                                RemoteKeyboardShortcuts(session::sendKey, enabled = inputEnabled)
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    TextButton(onClick = {
                                        val pasted = try { clipboard.getText()?.text.orEmpty() } catch (_: RuntimeException) { null }
                                        pasteFeedback = when {
                                            pasted == null -> Str.remotePasteUnavailable
                                            pasted.isEmpty() -> Str.remotePasteEmpty
                                            remoteText.length + pasted.length > 8000 -> Str.remotePasteTooLarge
                                            else -> { remoteText += pasted; null }
                                        }
                                    }) { Text(Str.remotePastePhoneText) }
                                    if (isShiftedForKeyboard || canShiftForKeyboard) {
                                        TextButton(onClick = { manualKeyboardView = if (isShiftedForKeyboard) transform else shiftedTransform }) {
                                            Text(if (isShiftedForKeyboard) Str.remoteKeyboardShiftRestore else Str.remoteKeyboardShiftUp)
                                        }
                                    }
                                }
                            }
                            val hint = pasteFeedback ?: when {
                                remoteText.length > 256 -> Str.remoteTextLimit
                                textInputSupported -> Str.remoteClipboardHint
                                else -> null
                            }
                            if (hint != null) Text(hint, Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.labelSmall)
                            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                RemoteKeyboardGrip(grip)
                                IconToggleButton(checked = toolsOpen, onCheckedChange = { toolsOpen = it }) {
                                    Icon(Icons.Default.MoreVert, contentDescription = Str.remoteKeyboardTools)
                                }
                                OutlinedTextField(remoteText, {
                                    if (it.length <= 8000) { remoteText = it; pasteFeedback = null } else pasteFeedback = Str.remotePasteTooLarge
                                }, Modifier.weight(1f).focusRequester(textFocusRequester), maxLines = 2, isError = remoteText.length > 256,
                                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                                    keyboardActions = KeyboardActions(onSend = { sendRemoteText() }),
                                    placeholder = { Text(if (textInputSupported) Str.remoteTextInputReady else Str.remoteTextInputUpdate, maxLines = 1) })
                                TextButton(onClick = { closeKeyboard(); dialogKeyboard?.hide() }, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.collapse, maxLines = 1) }
                                Button(onClick = ::sendRemoteText, enabled = remoteText.isNotBlank() && remoteText.length <= 256 && textInputSupported && inputEnabled, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.send, maxLines = 1, softWrap = false) }
                            }
                        }
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
    }
}

@Composable
private fun RemoteCanvas(
    session: NativeRemoteDesktopSession,
    stats: RemoteStreamStats?,
    interactive: Boolean,
    message: String?,
    modifier: Modifier,
    transform: RemoteViewTransform = RemoteViewTransform(),
    onTransform: (RemoteViewTransform) -> Unit = {},
    relativePointer: Boolean = false,
    directTouch: Boolean = true,
    pointerSpeed: Int = 1,
    editingText: Boolean = false,
    showCursor: Boolean = false,
    onRetry: () -> Unit = {},
    onExit: () -> Unit = {},
    pointerInput: RemotePointerInput,
    bottomInsetPx: Float = 0f,
    onViewportSize: (IntSize) -> Unit = {},
) {
    if (message != null && message != Str.remoteCaptureWaiting) {
        Surface(modifier, color = MaterialTheme.colorScheme.surfaceContainerLow) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                RemoteCaptureRecoveryCard(message, onRetry, onExit, Modifier.verticalScroll(rememberScrollState()), compact = !interactive)
            }
        }
        return
    }
    val useTrackpad = relativePointer || !directTouch
    val videoSize by session.videoSize.collectAsState()
    val inputEnabled by session.inputEnabled.collectAsState()
    val frameWidth = videoSize?.width ?: stats?.frameWidth
    val frameHeight = videoSize?.height ?: stats?.frameHeight
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    val density = androidx.compose.ui.platform.LocalDensity.current.density
    val fitForPointer = fitRemoteVideo(viewport.width, viewport.height, frameWidth, frameHeight)
    val localCursor = remember(session, relativePointer, useTrackpad, showCursor) { mutableStateOf<RemotePointerPosition?>(null) }
    LaunchedEffect(viewport, frameWidth, frameHeight, transform.scale) {
        val fit = fitRemoteVideo(viewport.width, viewport.height, frameWidth, frameHeight)
        session.updateViewport((fit.width * transform.scale).roundToInt(), (fit.height * transform.scale).roundToInt())
    }
    Box(modifier.background(if (message == null) Color.Black else MaterialTheme.colorScheme.surfaceContainerLow).clipToBounds().onSizeChanged {
        viewport = it
        onViewportSize(it)
        if (interactive) onTransform(transformRemoteView(transform, 1f, it.width / 2f, it.height / 2f, 0f, 0f, it.width, it.height, frameWidth, frameHeight, bottomInsetPx))
    }, contentAlignment = Alignment.Center) {
        // SurfaceViewRenderer uses its measured aspect ratio for EGL cropping, even with FIT.
        // Give it the fitted video size instead of forcing the entire viewport's aspect ratio.
        AndroidView(modifier = Modifier.matchParentSize().layout { measurable, constraints ->
            val fit = fitRemoteVideo(constraints.maxWidth, constraints.maxHeight, frameWidth, frameHeight)
            val video = measurable.measure(Constraints.fixed(fit.width, fit.height))
            layout(constraints.maxWidth, constraints.maxHeight) {
                video.place((constraints.maxWidth - video.width) / 2, (constraints.maxHeight - video.height) / 2)
            }
        }.graphicsLayer {
            scaleX = transform.scale; scaleY = transform.scale
            translationX = transform.panX; translationY = transform.panY
        }, factory = { session.createRenderer() }, onRelease = { session.releaseRenderer(it) })
        if (interactive && showCursor && !relativePointer) RemoteCursorOverlay(Modifier.matchParentSize(), fitForPointer, transform) { localCursor.value }
        if (interactive) RemoteTouchLayer(
            frameWidth = frameWidth, frameHeight = frameHeight, transform = transform,
            onTransform = onTransform,
            onPointer = { type, p, button, action ->
                if (session.inputEnabled.value) {
                    pointerInput.pointer(type, p, button, action, trackpad = useTrackpad)
                    if (showCursor && !relativePointer && !useTrackpad) localCursor.value = p
                }
            },
            onScroll = { dx, dy -> if (session.inputEnabled.value) session.sendScroll(dx, dy) },
            onKey = { code, down -> if (session.inputEnabled.value) androidRemoteKeyCode(code)?.let { session.sendKey(it, if (down) "down" else "up") } },
            modifier = Modifier.matchParentSize(),
            trackpadMode = useTrackpad, onRelativePointer = move@ { dx, dy ->
                if (!session.inputEnabled.value) return@move
                val gain = when (pointerSpeed) { 0 -> .6f; 2 -> 1.5f; else -> 1f }
                pointerInput.moveBy(dx * gain, dy * gain, (fitForPointer.width * transform.scale / density).roundToInt(),
                    (fitForPointer.height * transform.scale / density).roundToInt(), relativePointer)
                if (!relativePointer) {
                    if (showCursor) localCursor.value = pointerInput.currentPosition()
                    val next = followTrackpadCursor(transform, pointerInput.currentPosition(), viewport.width, viewport.height, frameWidth, frameHeight, bottomInsetPx)
                    if (next != transform) onTransform(next)
                }
            },
            requestKeyboardFocus = !editingText,
            bottomInsetPx = bottomInsetPx,
            inputEnabled = inputEnabled,
        )
        message?.let {
            if (it == Str.remoteCaptureWaiting) Text(it, Modifier.padding(16.dp).background(MaterialTheme.colorScheme.surface).padding(12.dp), color = MaterialTheme.colorScheme.onSurface)
            else RemoteCaptureRecoveryCard(it, onRetry, onExit, compact = !interactive)
        }
    }
}
