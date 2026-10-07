package org.agent567.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals

class SignalingRetryTest {
    @Test
    fun dropsBeforeDirectConnectionStopInsteadOfRetryingForever() {
        val retry = SignalingRetry()

        assertEquals(SignalingDrop.Stop, retry.dropped(directlyConnected = false))
    }

    @Test
    fun establishedDirectConnectionUsesBoundedBackoffAndResetsOnReopen() {
        val retry = SignalingRetry()

        assertEquals(SignalingDrop.Reconnect(1_000), retry.dropped(directlyConnected = true))
        assertEquals(SignalingDrop.Reconnect(2_000), retry.dropped(directlyConnected = true))
        repeat(8) { retry.dropped(directlyConnected = true) }
        assertEquals(SignalingDrop.Reconnect(SignalingRetry.MAX_DELAY_MS), retry.dropped(directlyConnected = true))

        retry.reopened()
        assertEquals(SignalingDrop.Reconnect(1_000), retry.dropped(directlyConnected = true))
    }
}
