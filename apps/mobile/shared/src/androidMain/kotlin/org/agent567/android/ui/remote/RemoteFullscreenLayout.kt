package org.agent567.android.ui.remote

import android.content.Context
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.AbsoluteAlignment
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

private enum class Overlay(val id: String, val x: Float, val y: Float) {
    Mouse("mouse", 1f, 1f), Keyboard("keyboard", 1f, .36f), Toolbar("toolbar", 1f, 0f),
    Draft("draft", .5f, 1f), Typing("ime-tools", .5f, 1f),
}

@Composable
internal actual fun rememberResetRemoteOverlayPositions(): () -> Unit {
    val prefs = LocalContext.current.getSharedPreferences("remote-controls", Context.MODE_PRIVATE)
    return remember(prefs) {
        { prefs.edit().apply { Overlay.entries.forEach { remove("${it.id}-x"); remove("${it.id}-y") } }.apply() }
    }
}

@Composable
internal fun RemoteFullscreenLayout(
    video: @Composable () -> Unit,
    toolbar: @Composable (Modifier) -> Unit,
    keyboard: @Composable (Modifier) -> Unit,
    controls: @Composable (Modifier) -> Unit,
    modifier: Modifier = Modifier,
    keyboardOpen: Boolean = false,
    layoutRevision: Int = 0,
    draftOpen: Boolean = false,
    onDraftOcclusion: (Float) -> Unit = {},
    banner: @Composable () -> Unit = {},
    mouse: @Composable (Modifier) -> Unit = {},
) {
    val toolbarState = rememberSaveableStateHolder()
    Box(modifier.fillMaxSize()) {
        Box(Modifier.matchParentSize()) { video() }
        BoxWithConstraints(Modifier.matchParentSize().displayCutoutPadding().navigationBarsPadding()
            .then(if (keyboardOpen) Modifier.imePadding() else Modifier).padding(horizontal = 6.dp, vertical = 4.dp)) {
            val area = IntSize(constraints.maxWidth, constraints.maxHeight)
            if (keyboardOpen) {
                val inset = WindowInsets.ime.getBottom(LocalDensity.current)
                FloatingControl(
                    if (draftOpen) Overlay.Draft else Overlay.Typing,
                    area,
                    layoutRevision,
                    Modifier.widthIn(max = minOf(maxWidth * .9f, 580.dp)).heightIn(max = maxHeight),
                    onBounds = { top, height ->
                        // Count any IME-docked bar (direct typing tools or draft box) when touching the IME top edge.
                        onDraftOcclusion((inset + if (top + height >= area.height - 1) height else 0).toFloat())
                    },
                    content = controls,
                )
            } else toolbarState.SaveableStateProvider("pointer-tools") {
                FloatingControl(Overlay.Mouse, area, layoutRevision, content = mouse)
                FloatingControl(Overlay.Keyboard, area, layoutRevision, content = keyboard)
                FloatingControl(Overlay.Toolbar, area, layoutRevision, Modifier.widthIn(max = maxWidth * .90f), content = toolbar)
            }
            Box(Modifier.align(Alignment.TopCenter)) { banner() }
        }
    }
}

@Composable
private fun BoxScope.FloatingControl(
    overlay: Overlay, area: IntSize, layoutRevision: Int, modifier: Modifier = Modifier,
    onBounds: ((Int, Int) -> Unit)? = null, content: @Composable (Modifier) -> Unit,
) = key(overlay) {
    val id = overlay.id
    val context = LocalContext.current
    val prefs = remember(context) { context.getSharedPreferences("remote-controls", Context.MODE_PRIVATE) }
    var x by remember(layoutRevision) { mutableFloatStateOf(prefs.getFloat("$id-x", overlay.x).coerceIn(0f, 1f)) }
    var y by remember(layoutRevision) { mutableFloatStateOf(prefs.getFloat("$id-y", overlay.y).coerceIn(0f, 1f)) }
    var size by remember { mutableStateOf(IntSize.Zero) }
    val dx = (area.width - size.width).coerceAtLeast(0)
    val dy = (area.height - size.height).coerceAtLeast(0)
    val top = (y * dy).roundToInt()
    SideEffect { onBounds?.invoke(top, size.height) }
    Box(Modifier.align(AbsoluteAlignment.TopLeft).absoluteOffset { IntOffset((x * dx).roundToInt(), top) }
        .then(modifier).onSizeChanged { size = it }) {
        content(Modifier.pointerInput(layoutRevision, dx, dy) {
            detectDragGestures(onDragEnd = { prefs.edit().putFloat("$id-x", x).putFloat("$id-y", y).apply() }) { change, delta ->
                change.consume()
                if (dx > 0) x = (x + delta.x / dx).coerceIn(0f, 1f)
                if (dy > 0) y = (y + delta.y / dy).coerceIn(0f, 1f)
            }
        })
    }
}
