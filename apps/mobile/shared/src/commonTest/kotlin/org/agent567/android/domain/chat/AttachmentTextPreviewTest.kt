package org.agent567.android.domain.chat

import kotlin.test.*
import org.agent567.android.domain.session.attachmentTextPreview

class AttachmentTextPreviewTest {
    @Test fun keepsTextCsvMarkdownAndBomEncodingReadable() {
        for (text in listOf("# 报告\n正文", "编号,名称\n00042,中文", "\uFEFFhello")) {
            assertEquals(text.removePrefix("\uFEFF"), attachmentTextPreview(text.encodeToByteArray()))
        }
        val text = "文档内容\n00042"
        val utf16 = byteArrayOf(0xff.toByte(), 0xfe.toByte()) + text.flatMap { listOf(it.code.toByte(), (it.code shr 8).toByte()) }.toByteArray()
        assertEquals(text, attachmentTextPreview(utf16))
    }
    @Test fun rejectsBinaryDocumentsEvenWhenTheirFirstBytesAreValidText() {
        for (bytes in listOf("%PDF-1.4\nplaintext stream".encodeToByteArray(), "PK\u0003\u0004...".encodeToByteArray(), "{\\rtf1 body}".encodeToByteArray(), byteArrayOf(0, 1, 2), byteArrayOf(0xff.toByte()))) {
            assertNull(attachmentTextPreview(bytes))
        }
    }
    @Test fun boundsLongPreviewsWithoutBreakingTheLastUtf8Character() {
        val text = "a".repeat(32767) + "中文"
        assertEquals("a".repeat(32767), attachmentTextPreview(text.encodeToByteArray()))
        assertEquals("", attachmentTextPreview(byteArrayOf()))
    }
}
