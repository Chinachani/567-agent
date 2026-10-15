package org.agent567.android.core.net

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.StateFlow

enum class NetworkAvailability { Unknown, Available, Unavailable }

/** Observes transport availability; a LAN without internet still counts as available. */
expect fun platformNetworkAvailability(): StateFlow<NetworkAvailability>

class ChatNetworkLostException : CancellationException("Chat network disconnected")

fun Throwable.isChatNetworkLoss(): Boolean {
    var error: Throwable? = this
    repeat(8) {
        if (error is ChatNetworkLostException) return true
        error = error?.cause
    }
    return false
}
