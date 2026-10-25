package org.agent567.android.domain.chat

import kotlin.io.encoding.Base64
import kotlin.test.*
import kotlinx.coroutines.test.runTest
import org.agent567.android.domain.conversation.RemoteDesktopImageChunk
import org.agent567.android.domain.session.readWorkbenchAttachmentChunks

class WorkbenchAttachmentReaderTest {
    @Test fun downloadsAndAssemblesTheOriginalFileUsingBoundedChunks() = runTest {
        val original = ByteArray(70000) { (it % 251).toByte() }
        val downloaded = readWorkbenchAttachmentChunks { offset, limit ->
            assertEquals(65536, limit)
            RemoteDesktopImageChunk("image/png", original.size, Base64.encode(original.copyOfRange(offset, minOf(offset + limit, original.size))), "revision")
        }
        assertContentEquals(original, downloaded)
    }
    @Test fun rejectsChangedIncompleteOrOversizedDownloads() = runTest {
        for (mode in listOf("changed", "empty", "oversized")) {
            assertFailsWith<IllegalArgumentException> {
                readWorkbenchAttachmentChunks { offset, _ ->
                    val bytes = if (offset == 0) ByteArray(65536) else if (mode == "empty") ByteArray(0) else ByteArray(1)
                    RemoteDesktopImageChunk("image/png", if (mode == "oversized") 13 * 1024 * 1024 else 65537, Base64.encode(bytes), if (offset > 0 && mode == "changed") "changed" else "revision")
                }
            }
        }
    }
}
