package org.agent567.android.domain.session

import kotlin.io.encoding.Base64
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.Serializable

@Serializable
data class RemoteSessionFile(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val size: Long,
    val modifiedAt: Double,
)

@Serializable
data class RemoteSessionFilePage(
    val path: String,
    val entries: List<RemoteSessionFile>,
    val nextOffset: Int? = null,
)

@Serializable
data class RemoteSessionFileChunk(
    val data: String,
    val offset: Int,
    val totalSize: Int,
    val modifiedAt: Double,
    val mimeType: String,
)

data class RemoteSessionFileContent(val bytes: ByteArray, val mimeType: String)

class RemoteFilesUnsupportedException : IllegalStateException("Desktop file browsing is unavailable")

/** Never joins bytes from different file versions, and never allocates beyond the negotiated limit. */
suspend fun readRemoteSessionFile(
    read: suspend (offset: Int, length: Int, modifiedAt: Double?) -> RemoteSessionFileChunk?,
): RemoteSessionFileContent {
    var result: ByteArray? = null
    var offset = 0
    var revision: Double? = null
    var mimeType: String? = null
    while (true) {
        currentCoroutineContext().ensureActive()
        val chunk = read(offset, 65536, revision) ?: throw RemoteFilesUnsupportedException()
        require(chunk.totalSize in 0..(10 * 1024 * 1024) && chunk.offset == offset)
        require(chunk.modifiedAt.isFinite() && (revision == null || revision == chunk.modifiedAt))
        require(mimeType == null || mimeType == chunk.mimeType)
        require(chunk.mimeType.length in 1..128 && chunk.data.length <= 87384)
        if (result == null) result = ByteArray(chunk.totalSize)
        require(result.size == chunk.totalSize)
        val bytes = Base64.decode(chunk.data)
        require(bytes.size <= 65536 && offset + bytes.size <= result.size)
        require(bytes.isNotEmpty() || offset == result.size)
        bytes.copyInto(result, offset)
        offset += bytes.size
        revision = chunk.modifiedAt
        mimeType = chunk.mimeType
        if (offset == result.size) return RemoteSessionFileContent(result, chunk.mimeType)
    }
}
