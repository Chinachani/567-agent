package org.agent567.android.domain.error

import org.agent567.android.core.error.VettaException
import org.agent567.android.domain.conversation.RemoteConversationException
import org.agent567.android.domain.remote.connection.RemoteRequestException
import org.agent567.android.domain.remote.protocol.RemoteError
import org.agent567.android.domain.remote.protocol.RemoteErrorCode
import kotlin.test.Test
import kotlin.test.assertEquals

class ErrorMapperTest {
    @Test
    fun mapsQuotaToOpenPlan() {
        val ui =
            ErrorMapper.from(
                VettaException.Api(httpStatus = 429, code = 42902, message = "额度尽"),
            )
        assertEquals(UiErrorAction.OpenPlan, ui.action)
        assertEquals("额度已用尽", ui.title)
    }

    @Test
    fun mapsUnauthorized() {
        val ui = ErrorMapper.from(VettaException.Unauthorized())
        assertEquals(UiErrorAction.ReLogin, ui.action)
    }

    @Test
    fun mapsRemoteAuthenticationFailureWithoutExposingProviderMessage() {
        val ui =
            ErrorMapper.from(
                RemoteRequestException(
                    RemoteError(
                        code = RemoteErrorCode.Unauthorized,
                        message = "invalid key suffix: sensitive",
                        retryable = false,
                    ),
                ),
            )

        assertEquals("桌面模型认证失败", ui.title)
        assertEquals("请在电脑端检查默认模型与 API Key 后重试", ui.message)
        assertEquals(UiErrorAction.None, ui.action)
    }

    @Test
    fun doesNotExposeUnknownExceptionMessage() {
        val ui = ErrorMapper.from(IllegalStateException("token=secret-value"))

        assertEquals("暂时无法完成操作，请稍后重试", ui.message)
    }

    @Test
    fun doesNotExposeUnknownApiMessage() {
        val ui =
            ErrorMapper.from(
                VettaException.Api(
                    httpStatus = 500,
                    code = 50000,
                    message = "upstream secret response",
                ),
            )

        assertEquals("服务暂时不可用，请稍后重试", ui.message)
    }

    @Test
    fun preservesActionableRemoteConversationMessage() {
        val ui = ErrorMapper.from(RemoteConversationException("当前电脑端版本不支持安全重试，请更新电脑端后再试"))

        assertEquals("当前电脑端版本不支持安全重试，请更新电脑端后再试", ui.message)
    }

    @Test
    fun truncatesRemoteErrorWithoutSplittingJoinedEmoji() {
        val family = "👨‍👩‍👧‍👦"
        val message = "a".repeat(296) + family + "tail"
        val ui = ErrorMapper.from(RemoteConversationException(message))

        assertEquals(296, ui.message.count { it == 'a' })
        assertEquals("a".repeat(296), ui.message)
    }
}
