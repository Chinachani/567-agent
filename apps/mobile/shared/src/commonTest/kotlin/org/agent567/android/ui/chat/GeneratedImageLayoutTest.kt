package org.agent567.android.ui.chat

import androidx.compose.ui.unit.dp
import androidx.compose.ui.geometry.Offset
import kotlin.test.Test
import kotlin.test.assertEquals

class GeneratedImageLayoutTest {
    @Test
    fun landscapeImageUsesAvailableWidthAndKeepsAspectRatio() {
        val size = generatedImageSize(360.dp, 460.dp, 1600, 900)

        assertEquals(360.dp, size.width)
        assertEquals(202.5.dp, size.height)
    }

    @Test
    fun portraitImageUsesLargeHeightWithoutExceedingMessageWidth() {
        val size = generatedImageSize(360.dp, 460.dp, 900, 1600)

        assertEquals(258.75.dp, size.width)
        assertEquals(460.dp, size.height)
    }

    @Test
    fun squareImageFillsTheAvailableWidth() {
        val size = generatedImageSize(360.dp, 460.dp, 1024, 1024)

        assertEquals(360.dp, size.width)
        assertEquals(360.dp, size.height)
    }

    @Test
    fun previewPanIsBoundedByTheScaledImageEdges() {
        val clamped = clampImagePreviewOffset(
            offset = Offset(900f, -900f),
            scale = 2f,
            imageWidthPx = 400f,
            imageHeightPx = 200f,
            viewportWidthPx = 400f,
            viewportHeightPx = 400f,
        )

        assertEquals(200f, clamped.x)
        assertEquals(0f, clamped.y)
    }

    @Test
    fun longScreenshotOpensAtReadableWidthAndStartsAtItsTopEdge() {
        val scale = initialImagePreviewScale(
            viewportWidthPx = 400f,
            imageWidthPx = 100f,
            imageHeightPx = 900f,
        )
        val offset = initialImagePreviewOffset(
            scale = scale,
            imageWidthPx = 100f,
            imageHeightPx = 900f,
            viewportWidthPx = 400f,
            viewportHeightPx = 600f,
        )

        assertEquals(4f, scale)
        assertEquals(1500f, offset.y)
    }

    @Test
    fun ordinaryPortraitPhotoKeepsFitToViewportScale() {
        assertEquals(1f, initialImagePreviewScale(400f, 300f, 500f))
    }
}
