package org.agent567.android.ui.remote

import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntSize
import kotlin.math.abs
import org.agent567.android.domain.remote.RemotePointerPosition
import org.agent567.android.domain.remote.RemoteViewTransform
import org.agent567.android.domain.remote.mapRemotePointer
import org.agent567.android.domain.remote.transformRemoteView

private enum class MultiFingerAction { Scroll, ViewTransform }

/** A single gesture owner prevents tap/drag recognizers from consuming each other's down events. */
@Composable
internal fun RemoteTouchLayer(
    frameWidth: Int?,
    frameHeight: Int?,
    transform: RemoteViewTransform,
    onTransform: (RemoteViewTransform) -> Unit,
    onPointer: (String, RemotePointerPosition, String?, String?) -> Unit,
    onScroll: (Float, Float) -> Unit,
    onKey: (Int, Boolean) -> Unit,
    modifier: Modifier = Modifier,
    trackpadMode: Boolean = false,
    onRelativePointer: (Float, Float) -> Unit = { _, _ -> },
) {
    var size by remember { mutableStateOf(IntSize.Zero) }
    val focus = remember { FocusRequester() }
    val latestTransform by rememberUpdatedState(transform)
    val latestOnTransform by rememberUpdatedState(onTransform)
    val latestOnPointer by rememberUpdatedState(onPointer)
    val latestOnScroll by rememberUpdatedState(onScroll)
    val latestOnKey by rememberUpdatedState(onKey)
    val latestOnRelative by rememberUpdatedState(onRelativePointer)
    Box(modifier.onSizeChanged { size = it }.focusRequester(focus).focusable().onKeyEvent {
        latestOnKey(it.nativeKeyEvent.keyCode, it.type == KeyEventType.KeyDown)
        true
    }.pointerInput(size, frameWidth, frameHeight, trackpadMode) {
        fun position(x: Float, y: Float, clamp: Boolean = false) = mapRemotePointer(x, y, size.width, size.height, frameWidth, frameHeight, clamp, latestTransform)
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            down.consume()
            val start = if (trackpadMode) RemotePointerPosition(0f, 0f) else position(down.position.x, down.position.y)
            var last = start
            var dragging = false
            var moved = false
            var relativeMovedBeforeHold = false
            var multiTouch = false
            var multiAction: MultiFingerAction? = null
            var accumulatedZoom = 1f
            var accumulatedPan = Offset.Zero
            var viewTransform = latestTransform
            try {
                do {
                    val event = awaitPointerEvent()
                    val pressed = event.changes.count { it.pressed }
                    if (pressed >= 2 || multiTouch) {
                        if (dragging) {
                            last?.let { latestOnPointer("pointer.button", it, "left", "up") }
                            dragging = false
                        }
                        // A multi-finger gesture owns the rest of this contact sequence.
                        multiTouch = true
                        if (pressed >= 2) {
                            val focal = event.calculateCentroid(useCurrent = false)
                            val pan = event.calculatePan()
                            val zoom = event.calculateZoom()
                            accumulatedZoom *= zoom
                            accumulatedPan += pan
                            if (pressed >= 3) multiAction = MultiFingerAction.ViewTransform
                            if (multiAction == null) {
                                if (abs(accumulatedZoom - 1f) >= .06f) multiAction = MultiFingerAction.ViewTransform
                                else if (accumulatedPan.getDistance() > viewConfiguration.touchSlop) {
                                    multiAction = MultiFingerAction.Scroll
                                    if (!trackpadMode) position(focal.x, focal.y)?.let { latestOnPointer("pointer.move", it, null, null) }
                                    latestOnScroll(-accumulatedPan.x / density, -accumulatedPan.y / density)
                                }
                                if (multiAction == MultiFingerAction.ViewTransform) {
                                    viewTransform = transformRemoteView(viewTransform, accumulatedZoom, focal.x, focal.y, accumulatedPan.x, accumulatedPan.y, size.width, size.height, frameWidth, frameHeight)
                                    latestOnTransform(viewTransform)
                                }
                            } else if (multiAction == MultiFingerAction.Scroll) {
                                latestOnScroll(-pan.x / density, -pan.y / density)
                            } else {
                                viewTransform = transformRemoteView(viewTransform, zoom, focal.x, focal.y, pan.x, pan.y, size.width, size.height, frameWidth, frameHeight)
                                latestOnTransform(viewTransform)
                            }
                        }
                    } else {
                        val primary = event.changes.firstOrNull { it.id == down.id }
                        if (primary != null && start != null) {
                            if (primary.pressed) {
                                if ((primary.position - down.position).getDistance() > viewConfiguration.touchSlop) {
                                    moved = true
                                    if (primary.uptimeMillis - down.uptimeMillis < viewConfiguration.longPressTimeoutMillis) relativeMovedBeforeHold = true
                                }
                                if (moved) {
                                    focus.requestFocus()
                                    if (trackpadMode) {
                                        // A normal slide moves the cursor; hold, then slide to drag.
                                        if (!dragging && primary.uptimeMillis - down.uptimeMillis >= viewConfiguration.longPressTimeoutMillis && !relativeMovedBeforeHold) {
                                            latestOnPointer("pointer.button", start, "left", "down")
                                            dragging = true
                                        }
                                        val delta = primary.position - primary.previousPosition
                                        latestOnRelative(delta.x / density, delta.y / density)
                                    } else {
                                        if (!dragging) {
                                            latestOnPointer("pointer.button", start, "left", "down")
                                            dragging = true
                                        }
                                        position(primary.position.x, primary.position.y, clamp = true)?.let {
                                            last = it
                                            latestOnPointer("pointer.move", it, null, null)
                                        }
                                    }
                                }
                            } else if (!moved && primary.previousPressed) {
                                focus.requestFocus()
                                val button = if (primary.uptimeMillis - down.uptimeMillis >= viewConfiguration.longPressTimeoutMillis) "right" else "left"
                                latestOnPointer("pointer.button", start, button, "down")
                                latestOnPointer("pointer.button", start, button, "up")
                            }
                        }
                    }
                    event.changes.forEach { it.consume() }
                } while (event.changes.any { it.pressed })
            } finally {
                // Covers cancellation, rotation, mode switches and leaving fullscreen mid-drag.
                if (dragging) last?.let { latestOnPointer("pointer.button", it, "left", "up") }
            }
        }
    })
}
