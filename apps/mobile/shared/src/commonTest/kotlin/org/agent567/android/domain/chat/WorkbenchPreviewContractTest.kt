package org.agent567.android.domain.chat

import kotlinx.serialization.json.Json
import org.agent567.android.domain.session.*
import kotlin.test.*

class WorkbenchPreviewContractTest {
    @Test fun oldDesktopDetailsStillDecodeAndRasterPreviewIsOptionalAndBounded() {
        val json = Json { ignoreUnknownKeys = true }
        val old = json.decodeFromString<SessionWorkbenchDetail>("""{"kind":"attachment","id":"file","title":"4316","text":"","previewStatus":"binary"}""")
        assertNull(old.thumbnailDataUrl)
        val preview = old.copy(thumbnailDataUrl = "data:image/png;base64,aGVsbG8=")
        assertEquals(preview, json.decodeFromString<SessionWorkbenchDetail>(json.encodeToString(preview)))
        assertEquals(preview.thumbnailDataUrl, validatedWorkbenchThumbnail(preview.thumbnailDataUrl))
        for (invalid in listOf("https://untrusted.invalid/image.png", "data:image/svg+xml;base64,AAAA", "data:image/png;base64," + "A".repeat(66000))) assertNull(validatedWorkbenchThumbnail(invalid))
    }
}
