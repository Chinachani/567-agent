package org.agent567.android.ui.remote

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.agent567.android.domain.remote.RemoteStreamStats
import org.agent567.android.domain.remote.RemoteViewTransform
import org.agent567.android.domain.remote.transformRemoteView
import org.agent567.android.domain.remote.fitRemoteVideo
import org.agent567.android.ui.i18n.Str
import kotlin.math.roundToInt

@Composable
actual fun RemoteDesktopSurface(target: String, modifier: Modifier) {
    val context = LocalContext.current
    // The session survives preview/fullscreen transitions; only the video sink moves.
    var attempt by remember(target) { mutableIntStateOf(0) }
    var exited by remember(target) { mutableStateOf(false) }
    val session = remember(target, attempt) { NativeRemoteDesktopSession(context.applicationContext, target) }
    val captureMessage by session.captureMessage.collectAsState()
    val connectionDetails by session.connectionDetails.collectAsState()
    val stats by session.streamStats.collectAsState()
    val textInputSupported by session.textInputSupported.collectAsState()
    val relativePointer by session.relativePointer.collectAsState()
    val inputEnabled by session.inputEnabled.collectAsState()
    var fullscreen by remember(target) { mutableStateOf(false) }
    var keyboardOpen by remember(target) { mutableStateOf(false) }
    var remoteText by remember(target) { mutableStateOf("") }
    var directTouch by remember(target) { mutableStateOf(true) }
    var transform by remember(target) { mutableStateOf(RemoteViewTransform()) }
    val textFocusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    LaunchedEffect(keyboardOpen) { if (keyboardOpen) { textFocusRequester.requestFocus(); keyboardController?.show() } }
    DisposableEffect(session) { session.start(); onDispose { session.stop() } }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(session, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START, Lifecycle.Event.ON_RESUME -> session.resumeRenderer()
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> session.pauseRenderer()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    fun closeFullscreen() { keyboardOpen = false; keyboardController?.hide(); fullscreen = false }
    fun retry() { exited = false; keyboardOpen = false; transform = RemoteViewTransform(); attempt++ }
    fun exit() { closeFullscreen(); exited = true; session.stop() }
    val visibleMessage = if (exited) Str.remoteExited else captureMessage

    Column(modifier) {
        if (!fullscreen) key(session) { RemoteCanvas(session, stats, false, visibleMessage, Modifier.fillMaxWidth().weight(1f), onRetry = ::retry, onExit = ::exit) }
        else Box(Modifier.fillMaxWidth().weight(1f).background(MaterialTheme.colorScheme.surfaceContainerLow), contentAlignment = Alignment.Center) { Text(Str.remoteDesktopFullscreen) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(stats?.roundTripMs?.let { "${it.roundToInt()} ms" } ?: Str.desktopPreview, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(enabled = !exited, onClick = { transform = RemoteViewTransform(); fullscreen = true }) { Text(Str.remoteDesktopFullscreen, maxLines = 1) }
        }
    }
    if (fullscreen) {
        RemoteFullscreenOrientation()
        Dialog(onDismissRequest = ::closeFullscreen, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        RemoteImmersiveWindow()
        Surface(Modifier.fillMaxSize(), color = Color.Black) {
            Box(Modifier.fillMaxSize().imePadding()) {
                Column(Modifier.fillMaxSize()) {
                    key(session) { RemoteCanvas(session, stats, true, visibleMessage, Modifier.fillMaxWidth().weight(1f), transform, { transform = it }, relativePointer, directTouch, ::retry, ::exit) }
                    if (keyboardOpen) {
                        Surface(color = MaterialTheme.colorScheme.surface) {
                            Column {
                            RemoteKeyboardShortcuts(session::sendKey)
                            if (textInputSupported) Text(Str.remoteClipboardHint, Modifier.padding(horizontal = 12.dp), style = MaterialTheme.typography.labelSmall)
                            Row(Modifier.fillMaxWidth().safeDrawingPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(remoteText, { remoteText = it.take(256) }, Modifier.weight(1f).focusRequester(textFocusRequester),
                                    singleLine = true, placeholder = { Text(if (textInputSupported) Str.remoteTextInputReady else Str.remoteTextInputUpdate, maxLines = 1) })
                                TextButton(onClick = { keyboardOpen = false; keyboardController?.hide() }) { Text(Str.collapse) }
                                Button(onClick = { session.sendText(remoteText); remoteText = "" }, enabled = remoteText.isNotBlank() && textInputSupported) { Text(Str.send, maxLines = 1, softWrap = false) }
                            }
                            }
                        }
                    }
                }
                RemoteFullscreenToolbar(
                    relativePointer = relativePointer, directTouch = directTouch, canReset = transform != RemoteViewTransform(),
                    stats = buildList { if (!inputEnabled) add(Str.viewOnly); stats?.roundTripMs?.let { add("${it.roundToInt()} ms") }; stats?.framesPerSecond?.let { add("${it.roundToInt()} FPS") } }.joinToString(" · ").ifBlank { Str.connectionStatus },
                    details = streamDescription(stats, connectionDetails), onExit = ::closeFullscreen,
                    onDirectTouch = { directTouch = it }, onReset = { transform = RemoteViewTransform() },
                    onKeyboard = { keyboardOpen = !keyboardOpen; if (!keyboardOpen) keyboardController?.hide() },
                    modifier = Modifier.align(Alignment.TopCenter),
                )
            }
        }
    }
    }
}

@Composable
private fun RemoteCanvas(session: NativeRemoteDesktopSession, stats: RemoteStreamStats?, interactive: Boolean, message: String?, modifier: Modifier, transform: RemoteViewTransform = RemoteViewTransform(), onTransform: (RemoteViewTransform) -> Unit = {}, relativePointer: Boolean = false, directTouch: Boolean = true, onRetry: () -> Unit = {}, onExit: () -> Unit = {}) {
    if (message == Str.remoteExited) {
        Box(modifier.background(Color.Black), contentAlignment = Alignment.Center) {
            RemoteCaptureRecoveryCard(message, onRetry, onExit)
        }
        return
    }
    var trackpadCursor by remember(session) { mutableStateOf(org.agent567.android.domain.remote.RemotePointerPosition(.5f, .5f)) }
    val useTrackpad = relativePointer || !directTouch
    val videoSize by session.videoSize.collectAsState()
    val frameWidth = videoSize?.width ?: stats?.frameWidth
    val frameHeight = videoSize?.height ?: stats?.frameHeight
    var viewport by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    LaunchedEffect(viewport, frameWidth, frameHeight, transform.scale) {
        val fit = fitRemoteVideo(viewport.width, viewport.height, frameWidth, frameHeight)
        session.updateViewport((fit.width * transform.scale).roundToInt(), (fit.height * transform.scale).roundToInt())
    }
    Box(modifier.background(Color.Black).clipToBounds().onSizeChanged {
        viewport = it
        if (interactive) onTransform(transformRemoteView(transform, 1f, it.width / 2f, it.height / 2f, 0f, 0f, it.width, it.height, frameWidth, frameHeight))
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
                val cursor = if (useTrackpad && !relativePointer) trackpadCursor else p
                session.sendPointer(type, cursor.x, cursor.y, button, action)
            },
            onScroll = session::sendScroll,
            onKey = { code, down -> androidRemoteKeyCode(code)?.let { session.sendKey(it, if (down) "down" else "up") } },
            modifier = Modifier.matchParentSize(),
            trackpadMode = useTrackpad, onRelativePointer = { dx, dy ->
                if (relativePointer) session.sendRelativePointer(dx, dy)
                else {
                    trackpadCursor = org.agent567.android.domain.remote.RemotePointerPosition((trackpadCursor.x + dx / (frameWidth ?: 1920)).coerceIn(0f, 1f), (trackpadCursor.y + dy / (frameHeight ?: 1080)).coerceIn(0f, 1f))
                    session.sendPointer("pointer.move", trackpadCursor.x, trackpadCursor.y)
                }
            },
        )
        message?.let {
            if (it == Str.remoteCaptureWaiting) Text(it, Modifier.padding(16.dp).background(MaterialTheme.colorScheme.surface).padding(12.dp), color = MaterialTheme.colorScheme.onSurface)
            else RemoteCaptureRecoveryCard(it, onRetry, onExit)
        }
    }
}

private fun streamDescription(stats: RemoteStreamStats?, connection: String?): String = buildList {
    connection?.let(::add)
    stats?.let {
        add(when (it.route) { RemoteStreamStats.Route.Lan -> Str.remoteLanRoute; RemoteStreamStats.Route.Internet -> Str.remoteInternetRoute; RemoteStreamStats.Route.Relayed -> Str.remoteRelayedRoute; null -> Str.remoteRouteChecking })
        if (it.frameWidth != null && it.frameHeight != null) add("${it.frameWidth}×${it.frameHeight}")
        it.pictureDelayMs?.let { delay -> add(Str.remotePictureDelay(delay.roundToInt())) }
    }
}.joinToString(" · ")
