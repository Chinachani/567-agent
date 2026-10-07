package org.agent567.android.domain.remote

/** WebRTC transport route and receive-side timing for the current screen stream. */
data class RemoteStreamStats(
    val route: Route? = null,
    val roundTripMs: Double? = null,
    val framesPerSecond: Double? = null,
    val frameWidth: Int? = null,
    val frameHeight: Int? = null,
    val jitterBufferMs: Double? = null,
    val decodeMs: Double? = null,
) {
    enum class Route { Lan, Internet, Relayed }

    val pictureDelayMs: Double?
        get() = roundTripMs?.let { it / 2 + (jitterBufferMs ?: 0.0) + (decodeMs ?: 0.0) }

    data class Entry(val id: String, val type: String, val values: Map<String, Any?>)
    data class FrameTotals(val jitterDelay: Double, val jitterFrames: Double, val decodeTime: Double, val decodedFrames: Double)

    companion object {
        fun route(local: String?, remote: String?): Route? {
            if (local == null || remote == null) return null
            if (local == "relay" || remote == "relay") return Route.Relayed
            if (local == "host" && remote == "host") return Route.Lan
            return Route.Internet
        }

        fun read(entries: Collection<Entry>, previous: FrameTotals?): Pair<RemoteStreamStats, FrameTotals?> {
            val byId = entries.associateBy(Entry::id)
            fun number(entry: Entry?, key: String): Double? = (entry?.values?.get(key) as? Number)?.toDouble()
            fun text(entry: Entry?, key: String): String? = entry?.values?.get(key) as? String

            val pair = entries.firstOrNull {
                it.type == "candidate-pair" && it.values["nominated"] == true && text(it, "state") == "succeeded"
            } ?: entries.firstOrNull { it.type == "candidate-pair" && it.values["nominated"] == true }
            var next = RemoteStreamStats()
            if (pair != null) {
                next = next.copy(
                    roundTripMs = number(pair, "currentRoundTripTime")?.times(1000),
                    route = route(
                        text(byId[text(pair, "localCandidateId")], "candidateType"),
                        text(byId[text(pair, "remoteCandidateId")], "candidateType"),
                    ),
                )
            }

            val video = entries.firstOrNull { it.type == "inbound-rtp" && text(it, "kind") == "video" } ?: return next to previous
            val totals = FrameTotals(
                jitterDelay = number(video, "jitterBufferDelay") ?: 0.0,
                jitterFrames = number(video, "jitterBufferEmittedCount") ?: 0.0,
                decodeTime = number(video, "totalDecodeTime") ?: 0.0,
                decodedFrames = number(video, "framesDecoded") ?: 0.0,
            )
            next = next.copy(
                framesPerSecond = number(video, "framesPerSecond"),
                frameWidth = number(video, "frameWidth")?.toInt(),
                frameHeight = number(video, "frameHeight")?.toInt(),
            )
            if (previous != null) {
                val emitted = totals.jitterFrames - previous.jitterFrames
                val decoded = totals.decodedFrames - previous.decodedFrames
                if (emitted > 0) next = next.copy(jitterBufferMs = (totals.jitterDelay - previous.jitterDelay) / emitted * 1000)
                if (decoded > 0) next = next.copy(decodeMs = (totals.decodeTime - previous.decodeTime) / decoded * 1000)
            }
            return next to totals
        }
    }
}
