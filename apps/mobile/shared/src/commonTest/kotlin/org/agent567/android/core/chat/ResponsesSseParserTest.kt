package org.agent567.android.core.chat

import kotlin.test.*
import org.agent567.android.core.model.*

class ResponsesSseParserTest {
    private fun ResponsesSseStreamParser.event(json: String) = parseLine("data: $json") + parseLine("")
    private val tool = """{"type":"function_call","status":"completed","call_id":"call-1","name":"generate_image","arguments":"{\"prompt\":\"a cat\"}"}"""
    @Test fun toolsAreReleasedOnceOnlyAfterCompletedAndUsageIsPreserved() {
        val parser = ResponsesSseStreamParser()
        assertTrue(parser.event("""{"type":"response.function_call_arguments.delta","delta":"partial"}""").isEmpty())
        assertTrue(parser.event("""{"type":"response.output_item.done","output_index":0,"item":$tool}""").isEmpty())
        val events = parser.event("""{"type":"response.completed","response":{"status":"completed","output":[$tool],"usage":{"input_tokens":20,"output_tokens":4,"total_tokens":24}}}""")
        assertEquals(1, events.filterIsInstance<ChatStreamEvent.Tool>().size)
        assertEquals("call-1", events.filterIsInstance<ChatStreamEvent.Tool>().single().toolCallId)
        assertEquals(24, events.filterIsInstance<ChatStreamEvent.Finished>().single().usage?.totalTokens)
        assertEquals(ChatStreamEvent.Done, events.last())
        assertTrue(parser.event("""{"type":"response.completed","response":{"status":"completed","output":[$tool]}}""").isEmpty())
    }
    @Test fun toolFactsNeverInventAnImageProgressLabelForAnyFunction() {
        for (name in listOf("generate_image", "search", "custom_function")) {
            val response = """{"status":"completed","output":[{"type":"function_call","call_id":"c","name":"$name","arguments":"{}"}]}"""
            val call = ResponsesSseStreamParser().parseNonStreamJson(response).filterIsInstance<ChatStreamEvent.Tool>().single()
            assertEquals(name, call.toolName)
            assertNull(call.phaseLabel)
        }
    }
    @Test fun failuresIncompleteAndTruncatedResponsesNeverReleaseTools() {
        for (end in listOf(
            """{"type":"response.failed","response":{"error":{"message":"unsupported"}}}""",
            """{"type":"response.incomplete","response":{"status":"incomplete","output":[$tool]}}""",
        )) {
            val parser = ResponsesSseStreamParser()
            parser.event("""{"type":"response.output_item.done","output_index":0,"item":$tool}""")
            val events = parser.event(end)
            assertTrue(events.none { it is ChatStreamEvent.Tool })
            assertTrue(events.any { it is ChatStreamEvent.Error })
        }
        val parser = ResponsesSseStreamParser()
        assertTrue(parser.event("""{"type":"response.output_item.done","output_index":0,"item":$tool}""").isEmpty())
        assertTrue(parser.event("[DONE]").isEmpty())
        assertTrue(parser.finish().isEmpty()) // transport requires a real terminal marker
    }
    @Test fun multilineFramingAndNonStreamJsonDoNotDuplicateTextAndRejectMalformedTools() {
        val parser = ResponsesSseStreamParser()
        parser.parseLine("data: {\"type\":\"response.output_text.delta\",")
        parser.parseLine("data: \"delta\":\"hello\",\"output_index\":0,\"content_index\":0}")
        val events = parser.parseLine("") + parser.event("""{"type":"response.completed","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"hello world"}]}]}}""")
        assertEquals("hello world", events.filterIsInstance<ChatStreamEvent.Delta>().joinToString("") { it.text })
        val plain = ResponsesSseStreamParser().parseNonStreamJson("""{"status":"completed","output":[{"type":"message","content":[{"type":"refusal","refusal":"cannot help"}]}]}""")
        assertEquals("cannot help", plain.filterIsInstance<ChatStreamEvent.Delta>().single().text)
        val empty = ResponsesSseStreamParser().parseNonStreamJson("""{"status":"completed","output":[]}""")
        assertEquals("stop", empty.filterIsInstance<ChatStreamEvent.Finished>().single().finishReason)
        assertEquals(ChatStreamEvent.Done, empty.last())
        val malformedTool = """[{"type":"function_call","call_id":"c","name":"generate_image","arguments":"{"}]"""
        assertTrue(ResponsesSseStreamParser().parseNonStreamJson("""{"status":"completed","output":$malformedTool}""").any { it is ChatStreamEvent.Error })
    }
    @Test fun oversizedEventsAndToolCountsAreRejected() {
        assertTrue(ResponsesSseStreamParser().parseLine("data: " + "x".repeat(1_000_001)).any { it is ChatStreamEvent.Error })
        val parser = ResponsesSseStreamParser()
        for (i in 0..15) assertTrue(parser.event("""{"type":"response.output_item.done","output_index":$i,"item":$tool}""").isEmpty())
        assertTrue(parser.event("""{"type":"response.output_item.done","output_index":16,"item":$tool}""").any { it is ChatStreamEvent.Error })
    }

    @Test fun capturesSignedReasoningAndDistinguishesStreamErrorsFromCancellation() {
        val parser = ResponsesSseStreamParser()
        val signed = """{"type":"reasoning","id":"rs_1","encrypted_content":"enc_abc","summary":[]}"""
        val unsigned = """{"type":"reasoning","id":"rs_2","summary":[{"type":"summary_text","text":"hi"}]}"""
        assertTrue(parser.event("""{"type":"response.output_item.done","output_index":0,"item":$signed}""").isEmpty())
        assertTrue(parser.event("""{"type":"response.output_item.done","output_index":1,"item":$unsigned}""").isEmpty())
        val events = parser.event("""{"type":"response.completed","response":{"status":"completed","output":[$signed,$unsigned,{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}}""")
        assertTrue(events.any { it is ChatStreamEvent.Done })
        assertEquals(1, parser.completedReasoningItems().size)
        assertTrue(parser.completedReasoningItems().single().contains("enc_abc"))

        val failedParser = ResponsesSseStreamParser()
        val failedEvents = failedParser.event("""{"type":"response.failed","response":{"error":{"code":"invalid_encrypted_content","message":"cannot verify"}}}""")
        val failedErr = failedEvents.filterIsInstance<ChatStreamEvent.Error>().single().exception as org.agent567.android.core.error.Agent567Exception.Protocol
        assertTrue(failedParser.lastFailureFromStreamError)
        assertEquals("invalid_encrypted_content", failedErr.providerCode)

        val topErrorParser = ResponsesSseStreamParser()
        val topErrorEvents = topErrorParser.event("""{"type":"error","error":{"code":"invalid_encrypted_content","message":"cannot verify"}}""")
        assertTrue(topErrorParser.lastFailureFromStreamError)
        assertTrue(topErrorEvents.single() is ChatStreamEvent.Error)

        val cancelledParser = ResponsesSseStreamParser()
        val cancelledEvents = cancelledParser.event("""{"type":"response.cancelled","response":{"error":{"code":"invalid_encrypted_content","message":"cancelled"}}}""")
        assertFalse(cancelledParser.lastFailureFromStreamError)
        assertTrue(cancelledEvents.single() is ChatStreamEvent.Error)
    }
}
