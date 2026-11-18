package org.agent567.android.ui.chat

/**
 * Snapshot of the composer state taken when dictation is triggered.
 */
data class DictationDraftSnapshot(
    val sessionId: String?,
    val draftVersion: Long,
    val baseDraft: String,
    val selectionStart: Int,
    val selectionEnd: Int,
)

sealed interface DictationApplyResult {
    data class Success(val newDraft: String, val newSelectionCursor: Int) : DictationApplyResult
    data object TooLong : DictationApplyResult
    data object Ignored : DictationApplyResult
}

object DraftDictationApplier {
    const val MAX_DRAFT_LENGTH = 100_000

    fun applyDictation(
        currentSessionId: String?,
        currentDraft: String,
        currentDraftVersion: Long,
        snapshot: DictationDraftSnapshot?,
        dictatedText: String,
    ): DictationApplyResult {
        val trimmed = dictatedText.trim()
        if (trimmed.isEmpty()) return DictationApplyResult.Ignored

        // 1. 会话变更防御：若用户在听写期间切换到了其他会话，直接忽略，避免跨会话污染草稿
        if (snapshot != null && snapshot.sessionId != currentSessionId) {
            return DictationApplyResult.Ignored
        }

        // 2. 检查草稿内容与版本是否未被修改
        val draftUnchanged = snapshot != null &&
            snapshot.draftVersion == currentDraftVersion &&
            snapshot.baseDraft == currentDraft

        val newDraft: String
        val newCursor: Int

        if (draftUnchanged) {
            // 3. 按选区插入：光标位置或选中区域替换为听写文本
            val min = snapshot.selectionStart.coerceIn(0, currentDraft.length)
            val max = snapshot.selectionEnd.coerceIn(min, currentDraft.length)
            val prefix = currentDraft.substring(0, min)
            val suffix = currentDraft.substring(max)
            newDraft = prefix + trimmed + suffix
            newCursor = prefix.length + trimmed.length
        } else {
            // 4. 草稿变更不覆盖新输入：用户在听写时输入了新内容，全量保留当前草稿并在末尾追加听写结果
            val separator = if (currentDraft.isBlank() || currentDraft.last().isWhitespace() || trimmed.first().isWhitespace()) "" else " "
            newDraft = currentDraft + separator + trimmed
            newCursor = newDraft.length
        }

        if (newDraft.length > MAX_DRAFT_LENGTH) {
            return DictationApplyResult.TooLong
        }

        return DictationApplyResult.Success(newDraft, newCursor)
    }
}
