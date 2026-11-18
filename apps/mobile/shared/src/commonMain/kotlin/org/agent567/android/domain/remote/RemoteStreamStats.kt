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
        get() = if (roundTripMs != null && jitterBufferMs != null && decodeMs != null) roundTripMs / 2 + jitterBufferMs + decodeMs else null

    data class Entry(val id: String, val type: String, val values: Map<String, Any?>)
    data class FrameTotals(val jitterDelay: Double?, val jitterFrames: Double?, val decodeTime: Double?, val decodedFrames: Double?,
        val streamId: String? = null)

    companion object {
        fun route(local: String?, remote: String?): Route? {
            if (local == null || remote == null) return null
            if (local == "relay" || remote == "relay") return Route.Relayed
            if (local == "host" && remote == "host") return Route.Lan
            return Route.Internet
        }

        fun read(entries: Collection<Entry>, previous: FrameTotals?): Pair<RemoteStreamStats, FrameTotals?> {
            val byId = entries.associateBy(Entry::id)
            fun number(entry: Entry?, key: String): Double? = (entry?.values?.get(key) as? Number)?.toDouble()?.takeIf { it.isFinite() && it >= 0 }
            fun text(entry: Entry?, key: String): String? = entry?.values?.get(key) as? String

            val video = entries.firstOrNull { it.type == "inbound-rtp" && text(it, "kind") == "video" }
            val transport = byId[text(video, "transportId")]
            val selectedId = text(transport, "selectedCandidatePairId")
            val pair = if (selectedId != null) byId[selectedId]?.takeIf { it.type == "candidate-pair" }
                else entries.filter {
                    it.type == "candidate-pair" && it.values["nominated"] == true && text(it, "state") == "succeeded"
                }.singleOrNull()
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

            if (video == null) return next to null
            val totals = FrameTotals(
                jitterDelay = number(video, "jitterBufferDelay"),
                jitterFrames = number(video, "jitterBufferEmittedCount"),
                decodeTime = number(video, "totalDecodeTime"),
                decodedFrames = number(video, "framesDecoded"),
                streamId = video.id,
            )
            next = next.copy(
                framesPerSecond = number(video, "framesPerSecond"),
                frameWidth = number(video, "frameWidth")?.toInt(),
                frameHeight = number(video, "frameHeight")?.toInt(),
            )
            if (previous != null && (previous.streamId == null || previous.streamId == video.id)) {
                fun averageMs(total: Double?, old: Double?, count: Double?, before: Double?): Double? {
                    if (total == null || old == null || count == null || before == null || total < old || count <= before) return null
                    return (total - old) * 1000 / (count - before)
                }
                next = next.copy(
                    jitterBufferMs = averageMs(totals.jitterDelay, previous.jitterDelay, totals.jitterFrames, previous.jitterFrames),
                    decodeMs = averageMs(totals.decodeTime, previous.decodeTime, totals.decodedFrames, previous.decodedFrames),
                )
            }
            return next to totals
        }
    }
}
