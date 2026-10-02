package org.agent567.android.core.api

import io.ktor.client.network.sockets.ConnectTimeoutException
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ChatConnectionRetryTest {
    @Test
    fun retriesOneConnectTimeoutBeforeTheServerResponds() = runTest {
        var attempts = 0
        var responseReceived = false

        val result = withChatConnectionRetry(responseReceived = { responseReceived }) {
            attempts += 1
            if (attempts == 1) throw ConnectTimeoutException("connect timeout")
            responseReceived = true
            "stream started"
        }

        assertEquals("stream started", result)
        assertEquals(2, attempts)
    }

    @Test
    fun doesNotRetryAfterAResponseOrAfterTheSecondConnectTimeout() = runTest {
        var attemptsAfterResponse = 0
        assertFailsWith<ConnectTimeoutException> {
            withChatConnectionRetry(responseReceived = { true }) {
                attemptsAfterResponse += 1
                throw ConnectTimeoutException("stream read timeout")
            }
        }
        assertEquals(1, attemptsAfterResponse)

        var attemptsBeforeResponse = 0
        assertFailsWith<ConnectTimeoutException> {
            withChatConnectionRetry(responseReceived = { false }) {
                attemptsBeforeResponse += 1
                throw ConnectTimeoutException("connect timeout")
            }
        }
        assertEquals(2, attemptsBeforeResponse)
    }
}
