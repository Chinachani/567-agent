package org.agent567.android.ui.remote

import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.material3.OutlinedTextField
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.agent567.android.ui.i18n.Str
import kotlin.math.roundToInt

@Composable
actual fun RemoteDesktopSurface(target: String, modifier: Modifier) {
    val context = LocalContext.current
    val session = remember(target) { NativeRemoteDesktopSession(context.applicationContext, target) }
    val captureMessage by session.captureMessage.collectAsState()
    val connectionDetails by session.connectionDetails.collectAsState()
    val streamStats by session.streamStats.collectAsState()
    val textInputSupported by session.textInputSupported.collectAsState()
    val focusRequester = remember { FocusRequester() }
    var size by remember { mutableStateOf(IntSize.Zero) }
    var lastPointerPosition by remember { mutableStateOf(Offset(.5f, .5f)) }
    var keyboardOpen by remember { mutableStateOf(false) }
    var remoteText by remember { mutableStateOf("") }
    val textFocusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    LaunchedEffect(target) {
        remoteText = ""
        keyboardOpen = false
        keyboardController?.hide()
    }
    LaunchedEffect(keyboardOpen) {
        if (keyboardOpen) textFocusRequester.requestFocus()
    }
    DisposableEffect(session) {
        session.start()
        onDispose { session.stop() }
    }
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
    Box(
        modifier
            .onSizeChanged { size = it }
            .focusRequester(focusRequester)
            .focusable()
            .onKeyEvent { event ->
                val action = if (event.type == KeyEventType.KeyDown) "down" else "up"
                session.sendKey(androidKeyCode(event.key.keyCode.toInt()), action)
                true
            }
            .pointerInput(session, size) {
                detectTapGestures(
                    onPress = { offset ->
                        focusRequester.requestFocus()
                        val x = if (size.width == 0) .5f else offset.x / size.width
                        val y = if (size.height == 0) .5f else offset.y / size.height
                        lastPointerPosition = Offset(x, y)
                        session.sendPointer("pointer.button", x, y, "left", "down")
                        tryAwaitRelease()
                        session.sendPointer("pointer.button", x, y, "left", "up")
                    },
                )
            }
            .pointerInput(session, size) {
                detectDragGestures(
                    onDragStart = { offset ->
                        focusRequester.requestFocus()
                        val x = if (size.width == 0) .5f else offset.x / size.width
                        val y = if (size.height == 0) .5f else offset.y / size.height
                        lastPointerPosition = Offset(x, y)
                        session.sendPointer("pointer.button", x, y, "left", "down")
                    },
                    onDrag = { change, _ ->
                        val x = if (size.width == 0) .5f else change.position.x / size.width
                        val y = if (size.height == 0) .5f else change.position.y / size.height
                        lastPointerPosition = Offset(x, y)
                        session.sendPointer("pointer.move", x, y)
                    },
                    onDragEnd = { session.sendPointer("pointer.button", lastPointerPosition.x, lastPointerPosition.y, "left", "up") },
                    onDragCancel = { session.sendPointer("pointer.button", lastPointerPosition.x, lastPointerPosition.y, "left", "up") },
                )
            }
            .pointerInput(session) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    var previousY = 0f
                    do {
                        val event = awaitPointerEvent()
                        val pressed = event.changes.filter { it.pressed }
                        if (pressed.size >= 2) {
                            val currentY = pressed.map { it.position.y }.average().toFloat()
                            if (previousY != 0f) session.sendScroll(0f, previousY - currentY)
                            previousY = currentY
                            pressed.forEach { it.consume() }
                        } else {
                            previousY = 0f
                        }
                    } while (event.changes.any { it.pressed })
                }
            },
    ) {
        AndroidView(modifier = Modifier.matchParentSize(), factory = { session.createRenderer() })
        Column(
            modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp),
            horizontalAlignment = Alignment.End,
        ) {
            if (keyboardOpen) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = remoteText,
                        onValueChange = { remoteText = it.take(256) },
                        modifier = Modifier.widthIn(max = 320.dp).focusRequester(textFocusRequester),
                        singleLine = false,
                        label = {
                            Text(
                                when {
                                    textInputSupported -> Str.remoteTextInputReady
                                    captureMessage == null -> Str.remoteTextInputUpdate
                                    else -> Str.remoteTextInputConnecting
                                },
                            )
                        },
                    )
                    Button(
                        onClick = {
                            session.sendText(remoteText)
                            remoteText = ""
                            keyboardController?.hide()
                        },
                        enabled = remoteText.isNotBlank() && textInputSupported,
                        modifier = Modifier.padding(start = 8.dp),
                    ) { Text("发送") }
                }
            }
            IconButton(onClick = {
                keyboardOpen = !keyboardOpen
                if (!keyboardOpen) keyboardController?.hide()
            }) {
                Text(if (keyboardOpen) "收起键盘" else "键盘")
            }
        }
        captureMessage?.let { message ->
            Surface(
                modifier = Modifier.align(Alignment.Center).padding(20.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.94f),
                contentColor = MaterialTheme.colorScheme.onSurface,
                shape = MaterialTheme.shapes.medium,
            ) {
                Column(Modifier.padding(horizontal = 20.dp, vertical = 14.dp)) {
                    Text(message)
                    connectionDetails?.let { detail ->
                        Text(detail, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 6.dp))
                    }
                }
            }
        }
        if (captureMessage == null && connectionDetails != null) {
            Surface(
                modifier = Modifier.align(Alignment.TopStart).padding(8.dp),
                color = MaterialTheme.colorScheme.surface.copy(alpha = 0.8f),
                contentColor = MaterialTheme.colorScheme.onSurface,
                shape = MaterialTheme.shapes.small,
            ) {
                Text(connectionDetails.orEmpty(), style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp))
            }
        }
        streamStats?.let { stats ->
            val route = when (stats.route) {
                org.agent567.android.domain.remote.RemoteStreamStats.Route.Lan -> "局域网直连"
                org.agent567.android.domain.remote.RemoteStreamStats.Route.Internet -> "互联网直连"
                org.agent567.android.domain.remote.RemoteStreamStats.Route.Relayed -> "中继线路"
                null -> null
            }
            val details = buildList {
                route?.let(::add)
                stats.roundTripMs?.let { add("RTT ${it.roundToInt()} ms") }
                if (stats.frameWidth != null && stats.frameHeight != null) add("${stats.frameWidth}×${stats.frameHeight}")
                stats.framesPerSecond?.let { add("${it.roundToInt()} FPS") }
                stats.pictureDelayMs?.let { add("画面延迟约 ${it.roundToInt()} ms") }
            }.joinToString(" · ")
            if (details.isNotBlank()) {
                Surface(
                    modifier = Modifier.align(Alignment.TopEnd).padding(8.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.82f),
                    contentColor = MaterialTheme.colorScheme.onSurface,
                    shape = MaterialTheme.shapes.small,
                ) {
                    Text(details, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp))
                }
            }
        }
    }
}

private fun androidKeyCode(code: Int): String = when {
    code in 29..54 -> "Key${('A'.code + code - 29).toChar()}"
    code in 7..16 -> "Digit${code - 7}"
    else -> mapOf(
        66 to "Enter", 111 to "Escape", 67 to "Backspace", 61 to "Tab", 62 to "Space",
        19 to "ArrowUp", 20 to "ArrowDown", 21 to "ArrowLeft", 22 to "ArrowRight", 112 to "Delete",
    )[code] ?: "AndroidKey$code"
}
