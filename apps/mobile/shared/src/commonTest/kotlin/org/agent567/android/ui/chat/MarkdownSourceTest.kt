package org.agent567.android.ui.chat

import kotlin.test.Test
import kotlin.test.assertEquals

class MarkdownSourceTest {
    @Test fun conversationOutputAndMessageTagsRemainVisibleAsLiteralText() {
        assertEquals(
            "收到 \\<output>结果\\</output> 和 \\<message>提示\\</message>",
            escapeConversationTags("收到 <output>结果</output> 和 <message>提示</message>"),
        )
    }

    @Test fun codeSpansFencesAndOrdinaryLinksAreUntouched() {
        val source = "`<output>`\n\n```xml\n<output>code</output>\n```\n\n[site](https://example.test)"
        assertEquals(source, escapeConversationTags(source))
    }

    @Test fun unrelatedHtmlAndUnknownTagsKeepTheirExistingMarkdownBehavior() {
        val source = "<br> <span>text</span> <tool>value</tool> <content>ignored</content>"
        assertEquals(source, escapeConversationTags(source))
    }

    @Test fun releaseNotesNormalizeCrLfAndTrimSurroundingWhitespace() {
        val raw = "\r\n## What's Changed\r\n- Fix dark icon\r- Render release notes\r\n\r\n"
        assertEquals("## What's Changed\n- Fix dark icon\n- Render release notes", normalizeReleaseNotesMarkdown(raw))
    }
}
