package org.vetta.android.core.api

import io.ktor.client.network.sockets.ConnectTimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

internal suspend fun <T> withChatConnectionRetry(
    responseReceived: () -> Boolean,
    request: suspend () -> T,
): T {
    var attempt = 0
    while (true) {
        try {
            return request()
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            if (attempt > 0 || responseReceived() || failure !is ConnectTimeoutException) throw failure
            attempt += 1
            delay(400)
        }
    }
}
