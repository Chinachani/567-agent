package org.agent567.android.domain.remote

import kotlin.test.*

class RemotePointerInputTest {
    private data class Input(val type: String, val position: RemotePointerPosition, val button: String?, val action: String?)
    private val sent = mutableListOf<Input>()
    private val relativeMoves = mutableListOf<Pair<Float, Float>>()
    private val input = RemotePointerInput(
        { type, position, button, action -> sent += Input(type, position, button, action) },
        { x, y -> relativeMoves += x to y },
    )

    @Test fun trackpadMovementThenLeftAndRightClicksKeepTheCurrentCursor() {
        input.moveBy(480f, -270f, 1920, 1080, relative = false)
        input.click("left")
        input.click("right")
        assertEquals(listOf(null, "left", "left", "right", "right"), sent.map { it.button })
        assertEquals(listOf(null, "down", "up", "down", "up"), sent.map { it.action })
        assertTrue(sent.all { it.position == RemotePointerPosition(.75f, .25f) })
        assertTrue(relativeMoves.isEmpty())
    }

    @Test fun tabletTouchThenRightButtonAndTrackpadSwitchPreserveTheTouchedPosition() {
        input.pointer("pointer.button", RemotePointerPosition(.8f, .3f), "left", "down", trackpad = false)
        input.pointer("pointer.button", RemotePointerPosition(.8f, .3f), "left", "up", trackpad = false)
        input.click("right")
        // Trackpad gestures carry a placeholder position; they must not move the cursor to (0, 0).
        input.pointer("pointer.button", RemotePointerPosition(0f, 0f), "left", "down", trackpad = true)
        input.pointer("pointer.button", RemotePointerPosition(0f, 0f), "left", "up", trackpad = true)
        assertTrue(sent.all { it.position == RemotePointerPosition(.8f, .3f) })
        assertEquals(listOf("down", "up", "down", "up", "down", "up"), sent.map { it.action })
    }

    @Test fun relativeHostUsesRelativeMovementAndCompleteButtonsWithoutAbsoluteMoves() {
        input.moveBy(45f, -20f, 1920, 1080, relative = true)
        input.click("left")
        input.click("right")
        assertEquals(listOf(45f to -20f), relativeMoves)
        assertTrue(sent.all { it.type == "pointer.button" })
        assertEquals(listOf("left", "left", "right", "right"), sent.map { it.button })
        assertEquals(listOf("down", "up", "down", "up"), sent.map { it.action })
    }
}
