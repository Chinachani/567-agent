package org.agent567.android.domain.session

/** Stores message image payloads outside the settings-backed message index. */
interface MessageImageFileStore {
    fun writeBytes(key: String, bytes: ByteArray): Boolean

    fun writeBase64(key: String, base64Data: String): Boolean

    fun readBytes(key: String): ByteArray?

    fun delete(key: String)
}

expect fun createPlatformMessageImageFileStore(): MessageImageFileStore

internal const val MAX_MESSAGE_IMAGE_BYTES = 12 * 1024 * 1024
internal const val MAX_MESSAGE_IMAGE_BASE64_CHARS = ((MAX_MESSAGE_IMAGE_BYTES + 2) / 3) * 4 + 8
