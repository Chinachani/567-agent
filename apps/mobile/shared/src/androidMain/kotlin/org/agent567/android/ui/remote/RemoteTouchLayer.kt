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
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.isSecondaryPressed
import androidx.compose.ui.input.pointer.isTertiaryPressed
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
    requestKeyboardFocus: Boolean = true,
    onRelativePointer: (Float, Float) -> Unit = { _, _ -> },
    bottomInsetPx: Float = 0f,
) {
    var size by remember { mutableStateOf(IntSize.Zero) }
    val focus = remember { FocusRequester() }
    // Remote taps remain usable while the IME edits the local draft. Don't steal its focus.
    val latestRequestFocus by rememberUpdatedState({ if (requestKeyboardFocus) focus.requestFocus(); Unit })
    val latestTransform by rememberUpdatedState(transform)
    val latestOnTransform by rememberUpdatedState(onTransform)
    val latestOnPointer by rememberUpdatedState(onPointer)
    val latestOnScroll by rememberUpdatedState(onScroll)
    val latestOnKey by rememberUpdatedState(onKey)
    val latestOnRelative by rememberUpdatedState(onRelativePointer)
    val latestBottomInsetPx by rememberUpdatedState(bottomInsetPx)
    val latestWidth by rememberUpdatedState(frameWidth)
    val latestHeight by rememberUpdatedState(frameHeight)
    // Same-aspect encoding resizes are not input mode changes. A real rotation cancels a drag.
    val portrait = frameWidth != null && frameHeight != null && frameHeight > frameWidth
    Box(modifier.onSizeChanged { size = it }.focusRequester(focus).focusable().onKeyEvent {
        if (it.type != KeyEventType.KeyDown && it.type != KeyEventType.KeyUp) return@onKeyEvent false
        val code = it.nativeKeyEvent.keyCode
        if (androidRemoteKeyCode(code) == null) return@onKeyEvent false
        latestOnKey(code, it.type == KeyEventType.KeyDown)
        true
    }.pointerInput(size, portrait, trackpadMode) {
        awaitPointerEventScope {
            while (true) {
                val event = awaitPointerEvent()
                when (event.type) {
                    PointerEventType.Scroll -> {
                        val change = event.changes.firstOrNull() ?: continue
                        val delta = change.scrollDelta
                        if (delta != Offset.Zero && delta.x.isFinite() && delta.y.isFinite()) {
                            if (!trackpadMode) {
                                val at = mapRemotePointer(change.position.x, change.position.y, size.width, size.height, latestWidth, latestHeight, false, latestTransform) ?: continue
                                latestOnPointer("pointer.move", at, null, null)
                            }
                            latestOnScroll(delta.x * 40f, delta.y * 40f)
                            change.consume()
                        }
                    }
                    PointerEventType.Move -> {
                        val change = event.changes.firstOrNull { !it.pressed && it.type == PointerType.Mouse }
                        if (change != null) {
                            if (trackpadMode) {
                                val delta = change.position - change.previousPosition
                                if (delta != Offset.Zero) latestOnRelative(delta.x / density, delta.y / density)
                            } else {
                                mapRemotePointer(change.position.x, change.position.y, size.width, size.height, latestWidth, latestHeight, false, latestTransform)
                                    ?.let { latestOnPointer("pointer.move", it, null, null) }
                            }
                            change.consume()
                        }
                    }
                }
            }
        }
    }.pointerInput(size, portrait, trackpadMode) {
        awaitEachGesture {
            val width = latestWidth
            val height = latestHeight
            fun position(x: Float, y: Float, clamp: Boolean = false) = mapRemotePointer(x, y, size.width, size.height, width, height, clamp, latestTransform)
            val down = awaitFirstDown(requireUnconsumed = false)
            down.consume()
            val isMouse = down.type == PointerType.Mouse
            val isStylus = down.type == PointerType.Stylus || down.type == PointerType.Eraser
            val initialButton = when {
                (isMouse || isStylus) && currentEvent.buttons.isTertiaryPressed -> "middle"
                (isMouse || isStylus) && currentEvent.buttons.isSecondaryPressed -> "right"
                else -> "left"
            }
            val start = if (trackpadMode) RemotePointerPosition(0f, 0f) else position(down.position.x, down.position.y)
            var last = start
            var dragging = false
            val pressedButton = initialButton
            var moved = false
            var relativeMovedBeforeHold = false
            var multiTouch = false
            var twoFingerTap = trackpadMode && down.type == PointerType.Touch
            val origins = mutableMapOf(down.id to down.position)
            var multiAction: MultiFingerAction? = null
            var scrollHasTarget = trackpadMode
            var accumulatedZoom = 1f
            var accumulatedPan = Offset.Zero
            var viewTransform = latestTransform
            try {
                if (isMouse && start != null) {
                    latestRequestFocus()
                    latestOnPointer("pointer.button", start, pressedButton, "down")
                    dragging = true
                }
                do {
                    val event = awaitPointerEvent()
                    val pressed = event.changes.count { it.pressed }
                    if (twoFingerTap) {
                        for (change in event.changes) {
                            val origin = origins.getOrPut(change.id) { change.position }
                            if (origins.size > 2 || change.type != PointerType.Touch || change.isConsumed ||
                                change.uptimeMillis - down.uptimeMillis > viewConfiguration.doubleTapTimeoutMillis ||
                                (change.position - origin).getDistance() > viewConfiguration.touchSlop) twoFingerTap = false
                        }
                    }
                    if (pressed >= 2 || multiTouch) {
                        if (dragging) {
                            last?.let { latestOnPointer("pointer.button", it, pressedButton, "up") }
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
                                    if (!trackpadMode && start != null) position(focal.x, focal.y)?.let {
                                        latestOnPointer("pointer.move", it, null, null)
                                        scrollHasTarget = true
                                    }
                                    if (scrollHasTarget) latestOnScroll(-accumulatedPan.x / density, -accumulatedPan.y / density)
                                }
                                if (multiAction == MultiFingerAction.ViewTransform) {
                                    viewTransform = transformRemoteView(viewTransform, accumulatedZoom, focal.x, focal.y, accumulatedPan.x, accumulatedPan.y, size.width, size.height, width, height, latestBottomInsetPx)
                                    latestOnTransform(viewTransform)
                                }
                            } else if (multiAction == MultiFingerAction.Scroll) {
                                if (scrollHasTarget) latestOnScroll(-pan.x / density, -pan.y / density)
                            } else {
                                viewTransform = transformRemoteView(viewTransform, zoom, focal.x, focal.y, pan.x, pan.y, size.width, size.height, width, height, latestBottomInsetPx)
                                latestOnTransform(viewTransform)
                            }
                        }
                    } else {
                        val primary = event.changes.firstOrNull { it.id == down.id }
                        if (primary != null && start != null) {
                            if (primary.pressed) {
                                if (isMouse) {
                                    if (trackpadMode) {
                                        val delta = primary.position - primary.previousPosition
                                        if (delta != Offset.Zero) latestOnRelative(delta.x / density, delta.y / density)
                                    } else {
                                        position(primary.position.x, primary.position.y, clamp = true)?.let {
                                            last = it
                                            latestOnPointer("pointer.move", it, null, null)
                                        }
                                    }
                                } else {
                                    if ((primary.position - down.position).getDistance() > viewConfiguration.touchSlop) {
                                        moved = true
                                        if (primary.uptimeMillis - down.uptimeMillis < viewConfiguration.longPressTimeoutMillis) relativeMovedBeforeHold = true
                                    }
                                    if (moved) {
                                        latestRequestFocus()
                                        if (trackpadMode) {
                                            // A normal slide moves the cursor; hold, then slide to drag.
                                            if (!dragging && primary.uptimeMillis - down.uptimeMillis >= viewConfiguration.longPressTimeoutMillis && !relativeMovedBeforeHold) {
                                                latestOnPointer("pointer.button", start, pressedButton, "down")
                                                dragging = true
                                            }
                                            val delta = primary.position - primary.previousPosition
                                            latestOnRelative(delta.x / density, delta.y / density)
                                        } else {
                                            if (!dragging) {
                                                latestOnPointer("pointer.button", start, pressedButton, "down")
                                                dragging = true
                                            }
                                            position(primary.position.x, primary.position.y, clamp = true)?.let {
                                                last = it
                                                latestOnPointer("pointer.move", it, null, null)
                                            }
                                        }
                                    }
                                }
                            } else if (primary.previousPressed) {
                                if (dragging) {
                                    last?.let { latestOnPointer("pointer.button", it, pressedButton, "up") }
                                    dragging = false
                                } else if (!isMouse && !moved) {
                                    latestRequestFocus()
                                    val button = if (initialButton != "left") initialButton else if (primary.uptimeMillis - down.uptimeMillis >= viewConfiguration.longPressTimeoutMillis) "right" else "left"
                                    latestOnPointer("pointer.button", start, button, "down")
                                    latestOnPointer("pointer.button", start, button, "up")
                                }
                            }
                        }
                    }
                    event.changes.forEach { it.consume() }
                } while (event.changes.any { it.pressed })
                if (twoFingerTap && multiTouch && origins.size == 2 && multiAction == null && !moved && start != null) {
                    latestRequestFocus()
                    latestOnPointer("pointer.button", start, "right", "down")
                    latestOnPointer("pointer.button", start, "right", "up")
                }
            } finally {
                // Covers cancellation, rotation, mode switches and leaving fullscreen mid-drag.
                if (dragging) last?.let { latestOnPointer("pointer.button", it, pressedButton, "up") }
            }
        }
    })
}
