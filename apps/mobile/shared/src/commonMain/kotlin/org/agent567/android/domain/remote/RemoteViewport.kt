package org.agent567.android.domain.remote

import kotlin.math.roundToInt

/** Coordinates inside an aspect-fit video; letterboxed margins never send clicks. */
data class RemotePointerPosition(val x: Float, val y: Float)
data class RemoteViewTransform(val scale: Float = 1f, val panX: Float = 0f, val panY: Float = 0f)
data class RemoteVideoSize(val width: Int, val height: Int)

/** Native video layout and pointer mapping share the same fitted dimensions. */
fun fitRemoteVideo(width: Int, height: Int, frameWidth: Int?, frameHeight: Int?): RemoteVideoSize {
    if (width <= 0 || height <= 0) return RemoteVideoSize(0, 0)
    if (frameWidth == null || frameWidth <= 0 || frameHeight == null || frameHeight <= 0) return RemoteVideoSize(width, height)
    val fit = minOf(width.toDouble() / frameWidth, height.toDouble() / frameHeight)
    return RemoteVideoSize((frameWidth * fit).roundToInt().coerceIn(1, width), (frameHeight * fit).roundToInt().coerceIn(1, height))
}

/** Zoom about the fingers' focal point, keeping the video inside its scroll bounds. */
fun transformRemoteView(
    current: RemoteViewTransform,
    zoom: Float,
    focusX: Float,
    focusY: Float,
    deltaX: Float,
    deltaY: Float,
    width: Int,
    height: Int,
    frameWidth: Int?,
    frameHeight: Int?,
    bottomInsetPx: Float = 0f,
): RemoteViewTransform {
    if (width <= 0 || height <= 0 || frameWidth == null || frameWidth <= 0 || frameHeight == null || frameHeight <= 0) return current
    if (listOf(zoom, focusX, focusY, deltaX, deltaY).any { !it.isFinite() } || zoom <= 0f) return current
    val inset = bottomInsetPx.takeIf { it.isFinite() && it > 0f }?.coerceAtMost(height * 0.85f) ?: 0f
    val scale = (current.scale * zoom).coerceIn(1f, 4f)
    if (scale == 1f && inset == 0f) return RemoteViewTransform()
    val ratio = scale / current.scale
    val fit = fitRemoteVideo(width, height, frameWidth, frameHeight)
    val maxX = maxOf(0f, (fit.width * scale - width) / 2)
    val maxY = maxOf(0f, (fit.height * scale - height) / 2)
    val keyboardMinY = if (inset > 0f) (height - fit.height * scale) / 2f - inset else -maxY
    val minY = minOf(-maxY, keyboardMinY)
    return RemoteViewTransform(
        scale,
        ((focusX - width / 2f) * (1 - ratio) + current.panX * ratio + deltaX).coerceIn(-maxX, maxX),
        ((focusY - height / 2f) * (1 - ratio) + current.panY * ratio + deltaY).coerceIn(minY, maxY),
    )
}

fun mapRemotePointer(x: Float, y: Float, width: Int, height: Int, frameWidth: Int?, frameHeight: Int?, clamp: Boolean = false, transform: RemoteViewTransform = RemoteViewTransform()): RemotePointerPosition? {
    if (width <= 0 || height <= 0 || !x.isFinite() || !y.isFinite()) return null
    val fw = frameWidth?.takeIf { it > 0 } ?: return null
    val fh = frameHeight?.takeIf { it > 0 } ?: return null
    val fit = fitRemoteVideo(width, height, fw, fh)
    if (!transform.scale.isFinite() || transform.scale !in 1f..4f || !transform.panX.isFinite() || !transform.panY.isFinite()) return null
    val videoWidth = fit.width * transform.scale; val videoHeight = fit.height * transform.scale
    val nx = (x - (width - videoWidth) / 2 - transform.panX) / videoWidth
    val ny = (y - (height - videoHeight) / 2 - transform.panY) / videoHeight
    if (!clamp && (nx !in 0f..1f || ny !in 0f..1f)) return null
    return RemotePointerPosition(nx.coerceIn(0f, 1f), ny.coerceIn(0f, 1f))
}

internal fun keyboardRemoteView(base: RemoteViewTransform, width: Int, height: Int, frameWidth: Int?, frameHeight: Int?, inset: Float): RemoteViewTransform {
    val fit = fitRemoteVideo(width, height, frameWidth, frameHeight)
    val blackBelow = ((height - fit.height * base.scale) / 2f - base.panY).coerceAtLeast(0f)
    return transformRemoteView(base, 1f, 0f, 0f, 0f, -(inset - blackBelow).coerceAtLeast(0f), width, height, frameWidth, frameHeight, inset)
}

/** Keep a locally known trackpad cursor in view when zoomed. Pan only at a visible edge. */
internal fun followTrackpadCursor(
    current: RemoteViewTransform, cursor: RemotePointerPosition, width: Int, height: Int,
    frameWidth: Int?, frameHeight: Int?, bottomInsetPx: Float,
): RemoteViewTransform {
    if (current.scale <= 1f || width <= 0 || height <= 0 || frameWidth == null || frameHeight == null) return current
    val fit = fitRemoteVideo(width, height, frameWidth, frameHeight)
    val x = width / 2f + current.panX + (cursor.x - .5f) * fit.width * current.scale
    val y = height / 2f + current.panY + (cursor.y - .5f) * fit.height * current.scale
    val visibleHeight = (height - bottomInsetPx.coerceIn(0f, height * .85f))
    fun correction(value: Float, extent: Float): Float = value.coerceIn(extent * .1f, extent * .9f) - value
    val dx = correction(x, width.toFloat())
    val dy = correction(y, visibleHeight)
    if (dx == 0f && dy == 0f) return current
    return transformRemoteView(current, 1f, 0f, 0f, dx, dy, width, height, frameWidth, frameHeight, bottomInsetPx)
}
