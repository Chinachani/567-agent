package org.agent567.android.domain.remote

import kotlin.test.*

class RemoteViewportTest {
    @Test fun wideFullscreenFitsAllFourVideoEdgesInsteadOfCroppingToTheWindowAspectRatio() {
        val fit = fitRemoteVideo(1920, 887, 1920, 1080)
        assertEquals(RemoteVideoSize(1577, 887), fit)
        val left = (1920 - fit.width) / 2f
        assertEquals(RemotePointerPosition(0f, 0f), mapRemotePointer(left, 0f, 1920, 887, 1920, 1080))
        assertEquals(RemotePointerPosition(1f, 1f), mapRemotePointer(left + fit.width, 887f, 1920, 887, 1920, 1080))
        assertNull(mapRemotePointer(left - 1, 400f, 1920, 887, 1920, 1080))
        assertEquals(RemoteVideoSize(499, 887), fitRemoteVideo(1920, 887, 1080, 1920))
    }

    @Test fun zoomKeepsTheFocalPointUnderTheFingersAndMapsClicksThroughTheTransform() {
        val before = mapRemotePointer(300f, 180f, 640, 360, 1920, 1080)!!
        val zoomed = transformRemoteView(RemoteViewTransform(), 2f, 300f, 180f, 0f, 0f, 640, 360, 1920, 1080)
        assertEquals(2f, zoomed.scale)
        assertEquals(before, mapRemotePointer(300f, 180f, 640, 360, 1920, 1080, transform = zoomed))
        val moved = transformRemoteView(zoomed, 1f, 300f, 180f, 80f, 0f, 640, 360, 1920, 1080)
        assertEquals(before, mapRemotePointer(380f, 180f, 640, 360, 1920, 1080, transform = moved))
    }
    @Test fun zoomAndPanStayBoundedAndZoomingBackOutRestoresFit() {
        val zoomed = transformRemoteView(RemoteViewTransform(), 20f, 320f, 180f, 9999f, -9999f, 640, 360, 1920, 1080)
        assertEquals(RemoteViewTransform(4f, 960f, -540f), zoomed)
        val fitted = transformRemoteView(zoomed, .01f, 320f, 180f, 0f, 0f, 640, 360, 1920, 1080)
        assertEquals(RemoteViewTransform(), fitted)
        assertEquals(zoomed, transformRemoteView(zoomed, Float.NaN, 0f, 0f, 0f, 0f, 640, 360, 1920, 1080))
        assertNull(mapRemotePointer(20f, 30f, 640, 360, 1920, 1080, transform = RemoteViewTransform(Float.NaN)))
    }
    @Test fun portraitControlMapsInsideFittedVideoAndIgnoresBlackMargins() {
        assertNull(mapRemotePointer(180f, 30f, 360, 640, 1920, 1080))
        assertEquals(RemotePointerPosition(.5f, .5f), mapRemotePointer(180f, 320f, 360, 640, 1920, 1080))
        assertEquals(RemotePointerPosition(0f, 0f), mapRemotePointer(0f, 218.5f, 360, 640, 1920, 1080))
        assertEquals(RemotePointerPosition(1f, 1f), mapRemotePointer(900f, 900f, 360, 640, 1920, 1080, clamp = true))
    }
    @Test fun landscapeAndUnknownDimensionsDoNotSendInvalidPositions() {
        assertEquals(RemotePointerPosition(.5f, .5f), mapRemotePointer(320f, 180f, 640, 360, 1920, 1080))
        assertNull(mapRemotePointer(1f, 1f, 0, 0, 1920, 1080))
        assertNull(mapRemotePointer(1f, 1f, 640, 360, null, null))
        assertNull(mapRemotePointer(Float.NaN, 1f, 640, 360, 1920, 1080))
    }
}
