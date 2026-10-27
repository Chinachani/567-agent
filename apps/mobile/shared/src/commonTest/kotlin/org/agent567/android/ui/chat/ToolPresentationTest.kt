package org.agent567.android.ui.chat

import kotlin.test.Test
import kotlin.test.assertEquals

class ToolPresentationTest {
    @Test
    fun fileToolUsesReadableLabelAndPathSummary() {
        assertEquals(
            ToolPresentation("读取文件", "README.md"),
            presentTool("read_file", "{\"path\":\"README.md\"}"),
        )
    }

    @Test
    fun shellToolShowsOnlyTheFirstCommandLine() {
        assertEquals(
            ToolPresentation("执行命令", "git status"),
            presentTool("bash", "{\"command\":\"git status\\nprintf done\"}"),
        )
    }

    @Test
    fun malformedArgumentsDoNotBreakTheTraceHeader() {
        assertEquals(ToolPresentation("执行操作"), presentTool("unknown_tool", "not-json"))
    }

    @Test
    fun parsedToolsUseLocalizedActionLabelsAndKeepRealRemoteProgress() {
        for ((name, expected) in listOf("generate_image" to "绘图工具", "read_file" to "读取文件", "custom_function" to "执行操作")) {
            val response = """{"status":"completed","output":[{"type":"function_call","call_id":"c","name":"$name","arguments":"{}"}]}"""
            val call = org.agent567.android.core.chat.ResponsesSseStreamParser().parseNonStreamJson(response)
                .filterIsInstance<org.agent567.android.core.model.ChatStreamEvent.Tool>().single()
            assertEquals(expected, toolActivityLabel(call.toolName, call.phaseLabel))
        }
        assertEquals("正在读取文件", toolActivityLabel("read_file", "  正在读取文件\n  "))
        assertEquals("执行操作", toolActivityLabel("custom", " "))
    }

    @Test
    fun questionResolutionProjectsSelectedLabelsWithoutExposingTheWholePayload() {
        assertEquals(
            ToolQuestionResolution(false, listOf("继续吗？" to listOf("继续"))),
            parseToolQuestionResolution(
                "ask_user_question",
                "{\"cancelled\":false,\"answers\":[{\"question\":\"继续吗？\",\"answers\":[\"继续\"]}]}",
            ),
        )
    }
}
