package org.agent567.android.core.chat

import org.agent567.android.core.model.ChatStreamEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class OpenAiSseParserTest {
    @Test
    fun parsesDelta() {
        val line =
            """data: {"id":"1","choices":[{"index":0,"delta":{"content":"你好"}}]}"""
        val event = OpenAiSseParser.parseLine(line)
        assertIs<ChatStreamEvent.Delta>(event)
        assertEquals("你好", event.text)
    }

    @Test
    fun parsesDone() {
        val event = OpenAiSseParser.parseLine("data: [DONE]")
        assertEquals(ChatStreamEvent.Done, event)
    }

    @Test
    fun parsesFinishReason() {
        val line =
            """data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}"""
        val event = OpenAiSseParser.parseLine(line)
        assertIs<ChatStreamEvent.Finished>(event)
        assertEquals("stop", event.finishReason)
        assertEquals(3, event.usage?.totalTokens)
    }

    @Test
    fun usageOnlyTailFrameIsPreservedWithoutCompletingAgain() {
        val parser = OpenAiSseStreamParser()
        assertEquals(1, parser.parseLine("""data: {"choices":[{"delta":{"content":"Answer"}}]}""").size)
        parser.parseLine("""data: {"choices":[{"delta":{},"finish_reason":"stop"}]}""")
        val tail = parser.parseLine("""data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":22,"total_tokens":33}}""")
        assertEquals(33, tail.filterIsInstance<ChatStreamEvent.State>().single().usage?.totalTokens)
        assertEquals(listOf(ChatStreamEvent.Done), parser.parseLine("data: [DONE]"))
    }

    @Test
    fun contentFinishAndUsageInOneFramePreserveAllEvents() {
        val events = OpenAiSseStreamParser().parseLine("""data: {"choices":[{"delta":{"content":"Answer"},"finish_reason":"stop"}],"usage":{"total_tokens":33}}""")
        assertEquals("Answer", events.filterIsInstance<ChatStreamEvent.Delta>().single().text)
        assertEquals(33, events.filterIsInstance<ChatStreamEvent.State>().single().usage?.totalTokens)
        assertEquals("stop", events.filterIsInstance<ChatStreamEvent.Finished>().single().finishReason)
    }

    @Test
    fun ignoresCommentsAndEmpty() {
        assertNull(OpenAiSseParser.parseLine(""))
        assertNull(OpenAiSseParser.parseLine(": keep-alive"))
        assertNull(OpenAiSseParser.parseLine("event: message"))
    }
}
