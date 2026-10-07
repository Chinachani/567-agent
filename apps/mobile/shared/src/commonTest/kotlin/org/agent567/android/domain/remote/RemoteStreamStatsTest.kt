package org.agent567.android.domain.remote

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RemoteStreamStatsTest {
    @Test
    fun reportsLanRouteRoundTripAndReceiveTiming() {
        val entries = listOf(
            RemoteStreamStats.Entry("local", "local-candidate", mapOf("candidateType" to "host")),
            RemoteStreamStats.Entry("remote", "remote-candidate", mapOf("candidateType" to "host")),
            RemoteStreamStats.Entry(
                "pair", "candidate-pair",
                mapOf("nominated" to true, "state" to "succeeded", "currentRoundTripTime" to .008, "localCandidateId" to "local", "remoteCandidateId" to "remote"),
            ),
            RemoteStreamStats.Entry(
                "video", "inbound-rtp",
                mapOf("kind" to "video", "framesPerSecond" to 30.0, "frameWidth" to 1920, "frameHeight" to 1080,
                    "jitterBufferDelay" to 2.2, "jitterBufferEmittedCount" to 160.0, "totalDecodeTime" to .8, "framesDecoded" to 160.0),
            ),
        )
        val previous = RemoteStreamStats.FrameTotals(1.0, 100.0, .5, 100.0)

        val (stats, totals) = RemoteStreamStats.read(entries, previous)

        assertEquals(RemoteStreamStats.Route.Lan, stats.route)
        assertEquals(8.0, stats.roundTripMs!!, .001)
        assertEquals(30.0, stats.framesPerSecond)
        assertEquals(1920 to 1080, stats.frameWidth to stats.frameHeight)
        assertEquals(20.0, stats.jitterBufferMs!!, .001)
        assertEquals(5.0, stats.decodeMs!!, .001)
        assertEquals(29.0, stats.pictureDelayMs!!, .001)
        assertEquals(160.0, totals?.jitterFrames)
    }

    @Test
    fun distinguishesLanInternetAndRelayRoutes() {
        assertEquals(RemoteStreamStats.Route.Lan, RemoteStreamStats.route("host", "host"))
        assertEquals(RemoteStreamStats.Route.Internet, RemoteStreamStats.route("srflx", "host"))
        assertEquals(RemoteStreamStats.Route.Relayed, RemoteStreamStats.route("host", "relay"))
        assertNull(RemoteStreamStats.route(null, "host"))
    }
}
