package org.agent567.android.ui.remote

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import org.agent567.android.domain.remote.RemoteVideoPreference
import org.agent567.android.domain.remote.RemoteStreamStats
import org.agent567.android.domain.remote.RemotePointerInput
import org.agent567.android.domain.remote.RemoteViewTransform
import org.agent567.android.domain.remote.transformRemoteView
import org.agent567.android.domain.remote.fitRemoteVideo
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.Agent567Theme
import kotlin.math.roundToInt

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
    val preferenceSupported by session.videoPreferenceSupported.collectAsState()
    val preferences = remember(context) { context.getSharedPreferences("remote-controls", android.content.Context.MODE_PRIVATE) }
    var videoPreference by remember { mutableStateOf(RemoteVideoPreference.entries.find { it.wire == preferences.getString("video-preference", "auto") } ?: RemoteVideoPreference.Auto) }
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
    var keyboardOpen by remember(target) { mutableStateOf(false) }
    var remoteText by remember(target) { mutableStateOf("") }
    var directTouch by rememberSaveable(target) { mutableStateOf(true) }
    var transform by remember(target) { mutableStateOf(RemoteViewTransform()) }
    var controlsBottomInsetPx by remember(target) { mutableFloatStateOf(0f) }
    var fullscreenViewport by remember(target) { mutableStateOf(IntSize.Zero) }
    val effectiveBottomInsetPx = if (keyboardOpen) controlsBottomInsetPx else 0f
    val frameWidth = videoSize?.width ?: stats?.frameWidth
    val frameHeight = videoSize?.height ?: stats?.frameHeight
    val textFocusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    LaunchedEffect(keyboardOpen) { if (keyboardOpen) { textFocusRequester.requestFocus(); keyboardController?.show() } }
    LaunchedEffect(fullscreen, effectiveBottomInsetPx, fullscreenViewport, frameWidth, frameHeight) {
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
    DisposableEffect(session) { session.start(); onDispose { session.stop() } }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(session, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START, Lifecycle.Event.ON_RESUME -> session.resumeRenderer()
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> {
                    session.releaseAllInputs()
                    session.pauseRenderer()
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    fun closeFullscreen() { session.releaseAllInputs(); keyboardOpen = false; keyboardController?.hide(); fullscreen = false }
    fun retry() { session.stop(); exited = false; keyboardOpen = false; controlsBottomInsetPx = 0f; transform = RemoteViewTransform(); attempt++ }
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
        RemoteFullscreenOrientation(lockLandscape = LocalConfiguration.current.smallestScreenWidthDp < 600)
        Dialog(onDismissRequest = ::closeFullscreen, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        RemoteImmersiveWindow()
        if (connectionPanel) RemoteConnectionPanel(stage, stats, inputEnabled, videoPreference, preferenceSupported,
            onPreference = {
                videoPreference = it
                preferences.edit().putString("video-preference", it.wire).apply()
                session.preferVideo(it)
            }, onReconnect = ::retry, onDismiss = { connectionPanel = false })
        Surface(Modifier.fillMaxSize(), color = Color.Black) {
            RemoteFullscreenLayout(
                video = {
                    key(session) {
                        RemoteCanvas(
                            session = session,
                            stats = stats,
                            interactive = true,
                            message = visibleMessage,
                            modifier = Modifier.fillMaxSize(),
                            transform = transform,
                            onTransform = { transform = it },
                            relativePointer = relativePointer,
                            directTouch = directTouch,
                            onRetry = ::retry,
                            onExit = ::exit,
                            pointerInput = pointerInput,
                            bottomInsetPx = effectiveBottomInsetPx,
                            onViewportSize = { fullscreenViewport = it },
                        )
                    }
                },
                toolbar = {
                    RemoteFullscreenToolbar(
                    relativePointer = relativePointer, directTouch = directTouch, canReset = transform != RemoteViewTransform(),
                    stats = buildList { if (!inputEnabled) add(Str.viewOnly); stats?.roundTripMs?.let { add("${it.roundToInt()} ms") }; stats?.framesPerSecond?.let { add("${it.roundToInt()} FPS") } }.joinToString(" · ").ifBlank { Str.connectionStatus },
                    details = stage.label(), onExit = ::closeFullscreen,
                    onDirectTouch = { session.releaseAllInputs(); directTouch = it }, onReset = { transform = RemoteViewTransform() },
                    onKeyboard = { session.releaseAllInputs(); keyboardOpen = !keyboardOpen; if (!keyboardOpen) keyboardController?.hide() },
                    onMouseButton = pointerInput::click,
                    inputEnabled = inputEnabled,
                    onConnectionPanel = { connectionPanel = true },
                    modifier = Modifier,
                    )
                },
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
                onBottomInsetChanged = { controlsBottomInsetPx = it },
                controls = {
                    if (keyboardOpen) Surface(color = MaterialTheme.colorScheme.surface) {
                        val shiftedTransform = transformRemoteView(
                            transform, 1f,
                            fullscreenViewport.width / 2f, fullscreenViewport.height / 2f,
                            0f, -effectiveBottomInsetPx,
                            fullscreenViewport.width, fullscreenViewport.height,
                            frameWidth, frameHeight,
                            effectiveBottomInsetPx,
                        )
                        val restoredTransform = transformRemoteView(
                            transform, 1f,
                            fullscreenViewport.width / 2f, fullscreenViewport.height / 2f,
                            0f, effectiveBottomInsetPx,
                            fullscreenViewport.width, fullscreenViewport.height,
                            frameWidth, frameHeight,
                            0f,
                        )
                        val normalMinY = if (fullscreenViewport.width > 0 && fullscreenViewport.height > 0 && frameWidth != null && frameWidth > 0 && frameHeight != null && frameHeight > 0) {
                            -maxOf(0f, (fitRemoteVideo(fullscreenViewport.width, fullscreenViewport.height, frameWidth, frameHeight).height * transform.scale - fullscreenViewport.height) / 2f)
                        } else 0f
                        val isShiftedForKeyboard = transform.panY < normalMinY - 1f
                        val canShiftForKeyboard = effectiveBottomInsetPx > 0f && shiftedTransform.panY < transform.panY - 1f
                        Column {
                            RemoteKeyboardShortcuts(session::sendKey, enabled = inputEnabled)
                            if (textInputSupported || isShiftedForKeyboard || canShiftForKeyboard) {
                                Row(
                                    Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    if (textInputSupported) Text(Str.remoteClipboardHint, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall)
                                    else Spacer(Modifier.weight(1f))
                                    if (isShiftedForKeyboard || canShiftForKeyboard) {
                                        TextButton(
                                            onClick = { transform = if (isShiftedForKeyboard) restoredTransform else shiftedTransform },
                                            modifier = Modifier.heightIn(min = 48.dp),
                                        ) {
                                            Text(if (isShiftedForKeyboard) Str.remoteKeyboardShiftRestore else Str.remoteKeyboardShiftUp, maxLines = 1)
                                        }
                                    }
                                }
                            }
                            TextButton(onClick = {
                                val pasted = clipboard.getText()?.text.orEmpty()
                                pasteFeedback = when {
                                    pasted.isEmpty() -> Str.remotePasteEmpty
                                    remoteText.length + pasted.length > 8000 -> Str.remotePasteTooLarge
                                    else -> { remoteText += pasted; null }
                                }
                            }, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.remotePastePhoneText) }
                            pasteFeedback?.let { Text(it, Modifier.padding(horizontal = 12.dp), style = MaterialTheme.typography.bodySmall) }
                            if (remoteText.length > 256) Text(Str.remoteTextLimit, Modifier.padding(horizontal = 12.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(remoteText, {
                                    if (it.length <= 8000) { remoteText = it; pasteFeedback = null } else pasteFeedback = Str.remotePasteTooLarge
                                }, Modifier.weight(1f).focusRequester(textFocusRequester), maxLines = 3, isError = remoteText.length > 256,
                                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                                    keyboardActions = KeyboardActions(onSend = { sendRemoteText() }),
                                    placeholder = { Text(if (textInputSupported) Str.remoteTextInputReady else Str.remoteTextInputUpdate, maxLines = 1) })
                                TextButton(onClick = { session.releaseAllInputs(); keyboardOpen = false; keyboardController?.hide() }, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.collapse, maxLines = 1) }
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
    val frameWidth = videoSize?.width ?: stats?.frameWidth
    val frameHeight = videoSize?.height ?: stats?.frameHeight
    var viewport by remember { mutableStateOf(IntSize.Zero) }
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
        if (interactive) RemoteTouchLayer(
            frameWidth = frameWidth, frameHeight = frameHeight, transform = transform,
            onTransform = onTransform,
            onPointer = { type, p, button, action ->
                pointerInput.pointer(type, p, button, action, trackpad = useTrackpad)
            },
            onScroll = session::sendScroll,
            onKey = { code, down -> androidRemoteKeyCode(code)?.let { session.sendKey(it, if (down) "down" else "up") } },
            modifier = Modifier.matchParentSize(),
            trackpadMode = useTrackpad, onRelativePointer = { dx, dy ->
                pointerInput.moveBy(dx, dy, frameWidth, frameHeight, relativePointer)
            },
            bottomInsetPx = bottomInsetPx,
        )
        message?.let {
            if (it == Str.remoteCaptureWaiting) Text(it, Modifier.padding(16.dp).background(MaterialTheme.colorScheme.surface).padding(12.dp), color = MaterialTheme.colorScheme.onSurface)
            else RemoteCaptureRecoveryCard(it, onRetry, onExit, compact = !interactive)
        }
    }
}
