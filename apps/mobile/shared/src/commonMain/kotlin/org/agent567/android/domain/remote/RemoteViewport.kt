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
): RemoteViewTransform {
    if (width <= 0 || height <= 0 || frameWidth == null || frameWidth <= 0 || frameHeight == null || frameHeight <= 0) return current
    if (listOf(zoom, focusX, focusY, deltaX, deltaY).any { !it.isFinite() } || zoom <= 0f) return current
    val scale = (current.scale * zoom).coerceIn(1f, 4f)
    if (scale == 1f) return RemoteViewTransform()
    val ratio = scale / current.scale
    val fit = fitRemoteVideo(width, height, frameWidth, frameHeight)
    val maxX = maxOf(0f, (fit.width * scale - width) / 2)
    val maxY = maxOf(0f, (fit.height * scale - height) / 2)
    return RemoteViewTransform(
        scale,
        ((focusX - width / 2f) * (1 - ratio) + current.panX * ratio + deltaX).coerceIn(-maxX, maxX),
        ((focusY - height / 2f) * (1 - ratio) + current.panY * ratio + deltaY).coerceIn(-maxY, maxY),
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
