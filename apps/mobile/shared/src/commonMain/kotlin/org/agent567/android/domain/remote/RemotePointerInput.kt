package org.agent567.android.domain.remote

/** The canvas and mouse buttons share one cursor, including on absolute-only hosts. */
internal class RemotePointerInput(
    private val sendPointer: (String, RemotePointerPosition, String?, String?) -> Unit,
    private val sendRelative: (Float, Float) -> Unit,
) {
    private var cursor = RemotePointerPosition(.5f, .5f)

    fun currentPosition(): RemotePointerPosition = cursor

    fun pointer(type: String, position: RemotePointerPosition, button: String?, action: String?, trackpad: Boolean) {
        if (!trackpad) cursor = position
        sendPointer(type, cursor, button, action)
    }

    fun moveBy(dx: Float, dy: Float, frameWidth: Int?, frameHeight: Int?, relative: Boolean) {
        if (relative) {
            sendRelative(dx, dy)
        } else {
            cursor = RemotePointerPosition(
                (cursor.x + dx / (frameWidth?.takeIf { it > 0 } ?: 1920)).coerceIn(0f, 1f),
                (cursor.y + dy / (frameHeight?.takeIf { it > 0 } ?: 1080)).coerceIn(0f, 1f),
            )
            sendPointer("pointer.move", cursor, null, null)
        }
    }

    fun click(button: String) {
        sendPointer("pointer.button", cursor, button, "down")
        sendPointer("pointer.button", cursor, button, "up")
    }
}
