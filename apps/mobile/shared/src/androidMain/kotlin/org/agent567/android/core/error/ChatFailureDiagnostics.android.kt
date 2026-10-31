package org.agent567.android.core.error

import android.util.Log
import org.agent567.android.diagnostics.MobileDiagnostics

internal actual fun recordChatFailure(stage: ChatFailureStage, error: Throwable) {
    val message = chatFailureDiagnostic(stage, error)
    MobileDiagnostics.record("WARN", message)
    // JVM host tests have no Android logging service.
    runCatching { Log.w("Agent567Chat", message) }
}
