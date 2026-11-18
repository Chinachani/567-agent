package org.agent567.android.domain.remote

/** The canvas and mouse buttons share one cursor, including on absolute-only hosts. */
internal class RemotePointerInput(
    private val sendPointer: (String, RemotePointerPosition, String?, String?) -> Unit,
    private val sendRelative: (Float, Float) -> Unit,
) {
    private var cursor = RemotePointerPosition(.5f, .5f)

    private var heldButton: String? = null
    private val canvasDown = mutableSetOf<String>()

    fun hold(button: String): (() -> Unit)? {
        if (heldButton != null || canvasDown.isNotEmpty()) return null
        heldButton = button
        sendPointer("pointer.button", cursor, button, "down")
        val owner = Any()
        holdOwner = owner
        return { if (holdOwner === owner) releaseHold() }
    }

    private var holdOwner: Any? = null
    private fun releaseHold() {
        val button = heldButton ?: return
        heldButton = null
        holdOwner = null
        sendPointer("pointer.button", cursor, button, "up")
    }

    fun resetButtons() {
        releaseHold()
        canvasDown.clear() // The session releases its tracked native inputs at the same boundary.
    }

    fun currentPosition(): RemotePointerPosition = cursor

    fun pointer(type: String, position: RemotePointerPosition, button: String?, action: String?, trackpad: Boolean) {
        if (!trackpad) cursor = position
        if (type == "pointer.button" && button != null) {
            if (heldButton != null) {
                if (!trackpad && action == "down") sendPointer("pointer.move", cursor, null, null)
                return
            }
            if (action == "down") canvasDown.add(button)
            else if (action == "up" && !canvasDown.remove(button)) return
        }
        sendPointer(type, cursor, button, action)
    }

    fun moveBy(dx: Float, dy: Float, padWidth: Int?, padHeight: Int?, relative: Boolean) {
        if (relative) {
            sendRelative(dx, dy)
        } else {
            cursor = RemotePointerPosition(
                (cursor.x + dx / (padWidth?.takeIf { it > 0 } ?: 1920)).coerceIn(0f, 1f),
                (cursor.y + dy / (padHeight?.takeIf { it > 0 } ?: 1080)).coerceIn(0f, 1f),
            )
            sendPointer("pointer.move", cursor, null, null)
        }
    }

    fun click(button: String) {
        if (heldButton != null || canvasDown.isNotEmpty()) return
        sendPointer("pointer.button", cursor, button, "down")
        sendPointer("pointer.button", cursor, button, "up")
    }
}
