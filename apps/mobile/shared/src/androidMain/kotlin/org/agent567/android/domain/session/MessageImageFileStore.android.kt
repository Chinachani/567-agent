package org.agent567.android.domain.session

import android.util.Base64
import org.agent567.android.data.session.AndroidMessageImageFileStore
import org.agent567.android.data.session.MessageImageFileSystem

private class PreviewMessageImageFileStore : MessageImageFileStore {
    private val files = mutableMapOf<String, ByteArray>()

    override fun writeBytes(key: String, bytes: ByteArray): Boolean {
        if (bytes.isEmpty() || bytes.size > MAX_MESSAGE_IMAGE_BYTES) return false
        files[key] = bytes.copyOf()
        return true
    }

    override fun writeBase64(key: String, base64Data: String): Boolean =
        if (base64Data.length > MAX_MESSAGE_IMAGE_BASE64_CHARS) {
            false
        } else {
            runCatching {
                val raw = base64Data.substringAfter(',', base64Data)
                val bytes = Base64.decode(raw, Base64.DEFAULT)
                writeBytes(key, bytes)
            }.getOrDefault(false)
        }

    override fun readBytes(key: String): ByteArray? = files[key]?.copyOf()

    override fun delete(key: String) {
        files.remove(key)
    }
}

actual fun createPlatformMessageImageFileStore(): MessageImageFileStore =
    MessageImageFileSystem.directory()?.let(::AndroidMessageImageFileStore) ?: PreviewMessageImageFileStore()
