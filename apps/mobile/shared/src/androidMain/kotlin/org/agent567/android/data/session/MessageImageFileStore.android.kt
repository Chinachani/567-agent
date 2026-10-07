package org.agent567.android.data.session

import android.content.Context
import android.util.Base64
import org.agent567.android.domain.session.MAX_MESSAGE_IMAGE_BASE64_CHARS
import org.agent567.android.domain.session.MAX_MESSAGE_IMAGE_BYTES
import org.agent567.android.domain.session.MessageImageFileStore
import java.io.File
import java.io.FileOutputStream

object MessageImageFileSystem {
    @Volatile private var appContext: Context? = null

    fun initialize(context: Context) {
        appContext = context.applicationContext
    }

    fun directory(): File? = appContext?.filesDir?.let { File(it, "chat-images") }
}

internal class AndroidMessageImageFileStore(
    private val root: File,
) : MessageImageFileStore {
    override fun writeBytes(key: String, bytes: ByteArray): Boolean {
        if (bytes.isEmpty() || bytes.size > MAX_MESSAGE_IMAGE_BYTES) return false
        return atomicWrite(key) { output ->
            output.write(bytes)
            true
        }
    }

    override fun writeBase64(key: String, base64Data: String): Boolean {
        if (base64Data.isEmpty() || base64Data.length > MAX_MESSAGE_IMAGE_BASE64_CHARS) return false
        val start = base64Data.indexOf(',').let { if (base64Data.startsWith("data:") && it >= 0) it + 1 else 0 }
        var decodedBytes = 0L
        return atomicWrite(key) { output ->
            val chunk = StringBuilder(64 * 1024)
            fun flush(final: Boolean): Boolean {
                if (chunk.isEmpty()) return true
                if (!final && chunk.length % 4 != 0) return false
                if (final) {
                    if (chunk.length % 4 == 1) return false
                    while (chunk.length % 4 != 0) chunk.append('=')
                }
                val bytes = Base64.decode(chunk.toString(), Base64.DEFAULT)
                decodedBytes += bytes.size
                if (decodedBytes > MAX_MESSAGE_IMAGE_BYTES) return false
                output.write(bytes)
                chunk.setLength(0)
                return true
            }
            for (index in start until base64Data.length) {
                val char = base64Data[index]
                if (char.isWhitespace()) continue
                val normalized = when (char) {
                    '-' -> '+'
                    '_' -> '/'
                    else -> char
                }
                if (normalized !in 'A'..'Z' && normalized !in 'a'..'z' && normalized !in '0'..'9' && normalized != '+' && normalized != '/' && normalized != '=') {
                    return@atomicWrite false
                }
                chunk.append(normalized)
                if (chunk.length == 64 * 1024 && !flush(final = false)) return@atomicWrite false
            }
            flush(final = true) && decodedBytes > 0
        }
    }

    override fun readBytes(key: String): ByteArray? {
        val file = resolve(key) ?: return null
        if (!file.isFile || file.length() !in 1..MAX_MESSAGE_IMAGE_BYTES.toLong()) return null
        return runCatching { file.readBytes() }.getOrNull()?.takeIf { it.size <= MAX_MESSAGE_IMAGE_BYTES }
    }

    override fun delete(key: String) {
        resolve(key)?.delete()
    }

    private fun atomicWrite(key: String, write: (FileOutputStream) -> Boolean): Boolean {
        val target = resolve(key) ?: return false
        return runCatching {
            root.mkdirs()
            val temp = File(root, "${target.name}.tmp")
            val success = FileOutputStream(temp).use(write)
            if (!success) {
                temp.delete()
                return false
            }
            if (target.exists()) target.delete()
            if (!temp.renameTo(target)) {
                temp.delete()
                false
            } else {
                true
            }
        }.getOrDefault(false)
    }

    private fun resolve(key: String): File? {
        if (!key.matches(Regex("[A-Za-z0-9_-]{1,96}"))) return null
        return File(root, "$key.img")
    }
}
