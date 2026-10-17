package org.agent567.android.domain.chat

import org.agent567.android.core.model.ChatRole
import org.agent567.android.domain.session.*

private fun messageGroups(messages: List<LocalMessage>): List<List<LocalMessage>> {
    val groups = mutableListOf<MutableList<LocalMessage>>()
    messages.forEach { message ->
        if (message.role == ChatRole.User) groups.add(mutableListOf())
        groups.lastOrNull()?.add(message)
    }
    return groups
}

fun localSessionWorkbench(messages: List<LocalMessage>, running: Boolean): SessionWorkbenchSnapshot {
    val groups = messageGroups(messages)
    return SessionWorkbenchSnapshot(
        attachments = messages.flatMap { message ->
            message.images.map { image -> SessionAttachmentAsset(image.id, image.fileName ?: "image", image.storageKey.orEmpty(), "image") } +
                message.files.map { file -> SessionAttachmentAsset(file.id, file.fileName, "", "file") }
        }.distinctBy { it.id }.takeLast(200),
        tasks = groups.takeLast(200).mapIndexed { index, group ->
            val first = group.first()
            val assistant = group.filter { it.role == ChatRole.Assistant }
            val last = assistant.lastOrNull()
            val status = when {
                last?.status == MessageStatus.Error -> "failed"
                last?.status == MessageStatus.Complete -> "completed"
                running && index == groups.takeLast(200).lastIndex -> "running"
                else -> "interrupted"
            }
            SessionTaskAsset(first.id, first.content.take(100), status, first.createdAtEpochMs, assistant.mapNotNull { it.processingDurationMs }.takeIf { it.isNotEmpty() }?.sum(), assistant.sumOf { it.toolEvents.distinctBy { tool -> tool.toolCallId }.size })
        }.reversed(),
    )
}

fun localSessionWorkbenchDetail(messages: List<LocalMessage>, kind: String, id: String): SessionWorkbenchDetail {
    if (kind == "task") {
        val group = messageGroups(messages).firstOrNull { it.first().id == id } ?: error("任务记录已不存在")
        return SessionWorkbenchDetail(kind, id, group.first().content.take(100), buildString {
            group.filter { it.role == ChatRole.Assistant }.forEach { message ->
                appendLine(message.content)
                message.errorMessage?.let { appendLine(it) }
                message.toolEvents.forEach { tool -> appendLine("[${tool.toolName} · ${tool.phase}]"); tool.result?.let { appendLine(it.take(8000)) } }
            }
        }.takeLast(32768))
    }
    if (kind == "attachment") {
        val file = localSessionWorkbench(messages, false).attachments.firstOrNull { it.id == id } ?: error("附件记录已不存在")
        return SessionWorkbenchDetail(kind, id, file.name, "", file.path, previewStatus = if (file.kind == "image") "binary" else "unavailable")
    }
    error("此手机 API 会话没有电脑文件修改记录")
}
