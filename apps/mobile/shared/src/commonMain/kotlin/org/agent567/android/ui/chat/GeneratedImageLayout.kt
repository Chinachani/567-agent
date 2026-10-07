package org.agent567.android.ui.chat

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.geometry.Offset

/** Fit a generated image inside the available width and height while preserving its source ratio. */
internal fun generatedImageSize(
    maxWidth: Dp,
    maxHeight: Dp,
    imageWidthPx: Int,
    imageHeightPx: Int,
): DpSize {
    require(imageWidthPx > 0 && imageHeightPx > 0) { "Image dimensions must be positive" }
    val aspectRatio = imageWidthPx.toFloat() / imageHeightPx
    val width = minOf(maxWidth, maxHeight * aspectRatio)
    return DpSize(width = width, height = width / aspectRatio)
}

internal fun clampImagePreviewOffset(
    offset: Offset,
    scale: Float,
    imageWidthPx: Float,
    imageHeightPx: Float,
    viewportWidthPx: Float,
    viewportHeightPx: Float,
): Offset {
    val maxX = ((imageWidthPx * scale - viewportWidthPx) / 2f).coerceAtLeast(0f)
    val maxY = ((imageHeightPx * scale - viewportHeightPx) / 2f).coerceAtLeast(0f)
    return Offset(
        x = if (maxX == 0f) 0f else offset.x.coerceIn(-maxX, maxX),
        y = if (maxY == 0f) 0f else offset.y.coerceIn(-maxY, maxY),
    )
}
