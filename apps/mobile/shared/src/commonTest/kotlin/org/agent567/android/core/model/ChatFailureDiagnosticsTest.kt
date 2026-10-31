package org.agent567.android.core.model

import org.agent567.android.core.error.Agent567Exception
import org.agent567.android.core.error.ChatFailureStage
import org.agent567.android.core.error.chatFailureDiagnostic
import org.agent567.android.core.error.ImagePayloadException
import org.agent567.android.core.error.ImagePayloadProblem
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ChatFailureDiagnosticsTest {
    @Test fun recordsFailureStageAndStatusWithoutProviderOrCredentialContents() {
        val error = Agent567Exception.Api(400, 123, "private prompt token=secret-value", "data:image/png;base64,PRIVATE")
        val diagnostic = chatFailureDiagnostic(ChatFailureStage.Image, error)
        assertTrue(diagnostic.contains("stage=image"))
        assertTrue(diagnostic.contains("httpStatus=400"))
        assertTrue(diagnostic.contains("code=123"))
        assertFalse(diagnostic.contains("private"))
        assertFalse(diagnostic.contains("secret"))
        assertFalse(diagnostic.contains("PRIVATE"))
    }

    @Test fun distinguishesContextLimitFromImageHttpFailure() {
        val context = Agent567Exception.Api(400, null, "The input token count exceeds the maximum number of tokens allowed 1048576.")
        assertTrue(chatFailureDiagnostic(ChatFailureStage.Chat, context).contains("category=context_limit"))
        assertFalse(chatFailureDiagnostic(ChatFailureStage.Image, IllegalStateException("private response")).contains("private response"))
    }

    @Test fun distinguishesMissingOutputFromInvalidImageBytesWithoutLoggingTheirContent() {
        for (problem in ImagePayloadProblem.entries) {
            val diagnostic = chatFailureDiagnostic(ChatFailureStage.Image, ImagePayloadException(problem, "private image response"))
            assertTrue(diagnostic.contains("imagePayload=${problem.name.lowercase()}"))
            assertFalse(diagnostic.contains("private image response"))
        }
    }
}
