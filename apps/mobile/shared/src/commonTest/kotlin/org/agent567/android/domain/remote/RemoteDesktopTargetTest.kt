package org.agent567.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RemoteDesktopTargetTest {
    @Test
    fun convertsControlRelayTargetToViewerTarget() {
        val id = "pairing-id-1234567890123456789012"
        val fingerprint = "a".repeat(64)
        val target =
            remoteDesktopViewerTarget(
                "wss://relay.example/v1/relay/$id/mobile#pairing=secret&fingerprint=$fingerprint",
            )

        assertEquals("wss://relay.example/v1/desktop/$id/viewer#pairing=secret&fingerprint=$fingerprint", target?.url)
        assertEquals(id, target?.sessionId)
        assertEquals(fingerprint, target?.certificateFingerprint)
    }

    @Test
    fun rejectsLegacyOrMalformedTargets() {
        assertNull(remoteDesktopViewerTarget("127.0.0.1:8787#pair"))
    }
}
