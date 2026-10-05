package org.agent567.android.domain.chat

import org.agent567.android.core.model.ChatRole
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageImage
import org.agent567.android.domain.session.MessageStatus

/**
 * 失败/中止轮次的重试载荷：去掉末尾失败助手与对应用户消息后，
 * 恢复草稿与**完整图片附件**再发送。
 */
data class RetryTurn(
    val assistantMessageId: String,
    val remainingMessages: List<LocalMessage>,
    val draft: String,
    val images: List<MessageImage>,
)

/**
 * 从会话消息列表解析重试载荷。无失败/中止助手气泡时返回 null。
 * 由 [org.agent567.android.ui.AppViewModel.retryLastError] 调用，测试直接驱动本函数。
 */
fun prepareRetryTurn(messages: List<LocalMessage>, assistantMessageId: String? = null): RetryTurn? {
    val lastAssistant =
        messages.lastOrNull {
            (assistantMessageId == null || it.id == assistantMessageId) &&
            it.role == ChatRole.Assistant &&
                (it.status == MessageStatus.Error || it.status == MessageStatus.Aborted)
        } ?: return null
    val lastUser =
        messages.lastOrNull {
            it.role == ChatRole.User && it.createdAtEpochMs <= lastAssistant.createdAtEpochMs
        } ?: return null
    return RetryTurn(
        assistantMessageId = lastAssistant.id,
        remainingMessages =
            messages.filterNot { it.id == lastAssistant.id || it.id == lastUser.id },
        draft = lastUser.content,
        images = lastUser.images,
    )
}

/**
 * 切换会话时是否应清空待发送附件。
 * 不同 session（含切到 null 空态）必须清空，避免串会话发送。
 */
fun shouldClearPendingImagesOnSessionChange(
    fromSessionId: String?,
    toSessionId: String?,
): Boolean = fromSessionId != toSessionId
