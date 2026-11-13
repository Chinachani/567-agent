package org.agent567.android.domain.remote

import kotlin.math.min

sealed interface SignalingDrop {
    data object Stop : SignalingDrop

    data class Reconnect(val afterMs: Long) : SignalingDrop
}

/** Briefly tolerate a host reconnect race; keep backing off while a direct peer is alive. */
class SignalingRetry {
    private var attempt = 0

    fun dropped(directlyConnected: Boolean): SignalingDrop {
        if (!directlyConnected && attempt >= STARTUP_RETRIES) return SignalingDrop.Stop
        val delay = min(FIRST_DELAY_MS * (1L shl attempt.coerceAtMost(5)), MAX_DELAY_MS)
        attempt += 1
        return SignalingDrop.Reconnect(delay)
    }

    fun reopened(directlyConnected: Boolean = true) {
        // A socket opening and immediately closing is not a recovered screen session.
        if (directlyConnected) attempt = 0
    }

    companion object {
        const val FIRST_DELAY_MS = 1_000L
        const val MAX_DELAY_MS = 30_000L
        const val STARTUP_RETRIES = 3
    }
}
