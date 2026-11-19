package org.agent567.android.ui.remote

import androidx.compose.foundation.focusable
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str
import org.agent567.android.domain.remote.RemotePointerPosition
import org.agent567.android.domain.remote.RemoteVideoSize
import org.agent567.android.domain.remote.RemoteViewTransform

@Composable
internal fun RemoteCursorOverlay(modifier: Modifier, fit: RemoteVideoSize, transform: RemoteViewTransform, cursor: () -> RemotePointerPosition?) {
    Canvas(modifier) {
        val point = cursor() ?: return@Canvas
        val x = center.x + transform.panX + (point.x - .5f) * fit.width * transform.scale
        val y = center.y + transform.panY + (point.y - .5f) * fit.height * transform.scale
        translate(x, y) {
            val arrow = Path().apply {
                moveTo(0f, 0f); lineTo(1.dp.toPx(), 15.dp.toPx()); lineTo(5.dp.toPx(), 10.dp.toPx())
                lineTo(11.dp.toPx(), 10.dp.toPx()); close()
            }
            drawPath(arrow, Color.Black, style = Stroke(2.dp.toPx()))
            drawPath(arrow, Color.White)
        }
    }
}

/** A short press clicks. A deliberate hold owns the down edge until release or cancellation. */
@Composable
internal fun RemoteMouseButton(label: String, enabled: Boolean, click: () -> Unit, hold: () -> (() -> Unit)?, leftFace: Boolean? = null) {
    RemoteHoldButton(label, enabled, click, hold) { holding ->
        if (leftFace != null) {
            val ink = if (holding) MaterialTheme.colorScheme.primary else LocalContentColor.current
            Canvas(Modifier.size(20.dp, 28.dp)) {
                val radius = CornerRadius(size.width / 2f)
                val split = size.height * .45f
                clipRect(if (leftFace) 0f else center.x, 0f, if (leftFace) center.x else size.width, split) {
                    drawRoundRect(ink, cornerRadius = radius)
                }
                drawRoundRect(ink, cornerRadius = radius, style = Stroke(1.5.dp.toPx()))
                drawLine(ink, Offset(center.x, 0f), Offset(center.x, split), 1.5.dp.toPx())
                drawLine(ink, Offset(0f, split), Offset(size.width, split), 1.5.dp.toPx())
            }
        } else Text(label, color = when { !enabled -> LocalContentColor.current.copy(alpha = .38f)
            holding -> MaterialTheme.colorScheme.tertiary
            else -> MaterialTheme.colorScheme.primary }, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}

@Composable
internal fun RemoteHoldButton(label: String, enabled: Boolean, click: () -> Unit, hold: () -> (() -> Unit)?, content: @Composable (Boolean) -> Unit) {
    val latestClick by rememberUpdatedState(click)
    val latestHold by rememberUpdatedState(hold)
    var holding by remember { mutableStateOf(false) }
    Box(Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics(mergeDescendants = true) {
        role = Role.Button
        contentDescription = label
        if (enabled) onClick { latestClick(); true } else disabled()
        if (holding) stateDescription = Str.remoteMouseHeld
    }.onKeyEvent {
        if (!enabled || it.key !in listOf(Key.Enter, Key.Spacebar, Key.DirectionCenter)) false
        else { if (it.type == KeyEventType.KeyUp) latestClick(); true }
    }.focusable(enabled).pointerInput(enabled) {
        if (!enabled) return@pointerInput
        var release: (() -> Unit)? = null
        fun finish() { val up = release; release = null; holding = false; up?.invoke() }
        try {
            detectTapGestures(
                onPress = { try { tryAwaitRelease() } finally { finish() } },
                onLongPress = { release = latestHold(); holding = release != null },
                onTap = { latestClick() },
            )
        } finally { finish() }
    }.padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        content(holding)
    }
}
