package org.agent567.android.ui.media

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals

class TextDocumentAttachmentTest {
    @Test
    fun preservesOriginalFileMetadataAndBytes() {
        val original = byteArrayOf(0x00, 0xFF.toByte(), 0x10, 0x22)
        val picked = PickedFileAttachment("sample.bin", "application/octet-stream", original)
        val pending = PendingFileAttachment("file-1", picked.fileName, picked.mimeType, picked.bytes)

        assertEquals("sample.bin", pending.fileName)
        assertEquals("application/octet-stream", pending.mimeType)
        assertContentEquals(original, pending.bytes)
    }
}
