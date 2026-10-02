package org.agent567.android.domain.remote

data class RemoteDesktopTarget(
    val url: String,
    val sessionId: String,
    val certificateFingerprint: String? = null,
)

fun remoteDesktopViewerTarget(controlUrl: String): RemoteDesktopTarget? {
    val match = Regex("^(wss?://[^#]+/v1/relay/([A-Za-z0-9_-]{24,128})/mobile)(#.+)?$").matchEntire(controlUrl)
        ?: return null
    val pairingId = match.groupValues[2]
    val secret = match.groupValues[3]
    val base = match.groupValues[1].substringBefore("/v1/relay/")
    val fragment = secret.removePrefix("#").split('&').associate {
        val separator = it.indexOf('=')
        if (separator < 0) it to "" else it.substring(0, separator) to it.substring(separator + 1)
    }
    val token = fragment["resume"] ?: fragment["pairing"] ?: return null
    val fingerprint = fragment["fingerprint"]?.lowercase()
    if (fingerprint != null && !fingerprint.matches(Regex("[a-f0-9]{64}"))) return null
    val viewerSecret = "#pairing=$token" + (fingerprint?.let { "&fingerprint=$it" } ?: "")
    return RemoteDesktopTarget("$base/v1/desktop/$pairingId/viewer$viewerSecret", pairingId, fingerprint)
}
