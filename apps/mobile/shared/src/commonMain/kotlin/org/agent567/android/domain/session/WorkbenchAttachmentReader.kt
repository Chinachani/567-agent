package org.agent567.android.domain.session

import kotlin.io.encoding.Base64
import org.agent567.android.domain.conversation.RemoteDesktopImageChunk

/** Chunk assembly belongs to the transfer boundary, independent of screen/navigation state. */
internal suspend fun readWorkbenchAttachmentChunks(read: suspend (offset: Int, limit: Int) -> RemoteDesktopImageChunk?): ByteArray {
    val output = mutableListOf<ByteArray>()
    var offset = 0
    var total: Int? = null
    var revision: String? = null
    while (true) {
        val chunk = read(offset, 65536) ?: error("电脑不支持原文件下载")
        require(chunk.sizeBytes in 0..(12 * 1024 * 1024) && (total == null || total == chunk.sizeBytes)) { "附件已变化或超过下载上限" }
        require(chunk.revision != null && (revision == null || revision == chunk.revision) && chunk.dataBase64.length <= 87384) { "原文件在传输中发生变化，请重新下载" }
        revision = chunk.revision
        total = chunk.sizeBytes
        val bytes = Base64.decode(chunk.dataBase64)
        require(bytes.size <= 65536 && (bytes.isNotEmpty() || offset == total)) { "附件数据不完整" }
        output.add(bytes)
        offset += bytes.size
        require(offset <= total) { "附件数据超出大小" }
        if (offset == total) break
    }
    return ByteArray(offset).also { bytes ->
        var index = 0
        output.forEach { part -> part.copyInto(bytes, index); index += part.size }
    }
}
