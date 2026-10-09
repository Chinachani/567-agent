package org.agent567.android.domain.remote.connection

import android.util.Log
import org.agent567.android.diagnostics.MobileDiagnostics

actual object PlatformRemoteLogger : RemoteLogger {
    override fun debug(message: String, fields: Map<String, Any?>) {
        log("DEBUG", message, fields) { Log.d(TAG, it) }
    }

    override fun info(message: String, fields: Map<String, Any?>) {
        log("INFO", message, fields) { Log.i(TAG, it) }
    }

    override fun warn(message: String, fields: Map<String, Any?>) {
        log("WARN", message, fields) { Log.w(TAG, it) }
    }

    private inline fun log(level: String, message: String, fields: Map<String, Any?>, write: (String) -> Int) {
        val formatted = format(message, fields)
        runCatching { write(formatted) }
        val safeFields = fields.filterKeys { it.lowercase() in DIAGNOSTIC_FIELD_ALLOWLIST }
        runCatching { MobileDiagnostics.record(level, format(message, safeFields)) }
    }

    private fun format(message: String, fields: Map<String, Any?>): String =
        if (fields.isEmpty()) message else "$message ${fields.entries.joinToString { "${it.key}=${it.value}" }}"

    private const val TAG = "Agent567Remote"
    private val DIAGNOSTIC_FIELD_ALLOWLIST = setOf(
        "state", "attempt", "attemptnumber", "status", "code", "error", "errortype", "reason", "type",
        "target", "phase",
        "expected", "received", "reconnectcount", "sequence", "durationms", "bytes",
        "connectionstate", "signalstate", "iceconnectionstate",
    )
}
