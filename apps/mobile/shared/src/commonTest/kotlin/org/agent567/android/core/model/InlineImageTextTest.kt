package org.agent567.android.core.model

import kotlin.test.Test
import kotlin.test.assertEquals

class InlineImageTextTest {
    @Test fun removesCompleteImageDataAndKeepsDescriptionAndFollowingText() {
        assertEquals("Before\n\n\n\nAfter", withoutInlineImageData("Before\n\n![image](data:image/png;base64,AAAA)\n\nAfter"))
        assertEquals("Before  After", withoutInlineImageData("Before ![图](<DATA:IMAGE/JPEG;BASE64,AAAA>) After"))
    }

    @Test fun unfinishedMillionCharacterPayloadNeverReachesTextLayout() {
        val source = "Ready\n\n![image](data:image/png;base64," + "A".repeat(1_000_000)
        assertEquals("Ready\n\n", withoutInlineImageData(source))
    }

    @Test fun preservesExplicitCodeExamplesAndOrdinaryLinks() {
        for (source in listOf(
            "`![image](data:image/png;base64,AAAA)`",
            "```markdown\n![image](data:image/png;base64,AAAA)\n```",
            "~~~markdown\n![image](data:image/png;base64,AAAA)\n~~~",
            "![image](https://example.test/image.png) [site](https://example.test)",
            "\\![image](data:image/png;base64,AAAA)",
        )) assertEquals(source, withoutInlineImageData(source))
    }

    @Test fun handlesSeveralImagesAndLeavesMalformedNonImageSyntaxAlone() {
        assertEquals("A  B  C", withoutInlineImageData("A ![one](data:image/png;base64,AAA) B ![two](data:image/webp;base64,BBB) C"))
        assertEquals("![image](data:image/png,not-base64)", withoutInlineImageData("![image](data:image/png,not-base64)"))
        assertEquals("data:image/png;base64,AAA", withoutInlineImageData("data:image/png;base64,AAA"))
        assertEquals("Before  After", withoutInlineImageData("Before ![nested [label]](data:image/png;base64,AAA) After"))
    }

    @Test fun fenceMarkersInsideCodeDoNotEndTheFence() {
        val code = "```markdown\nThe literal ``` is part of the example.\n![image](data:image/png;base64,AAAA)\n```"
        assertEquals(code, withoutInlineImageData(code))
    }

    @Test fun longerClosingFenceStillLetsFollowingImagePixelsBeRemoved() {
        val code = "```markdown\n![example](data:image/png;base64,AAAA)\n````"
        assertEquals("$code\n\nCaption ", withoutInlineImageData("$code\n\nCaption ![image](data:image/png;base64,BBBB)"))
    }
}
