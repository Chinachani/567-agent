package org.agent567.android.domain.remote

data class PairingInvite(
    val relayBaseUrl: String,
    val pairingId: String,
    val bootstrapSecret: String,
    val lanBaseUrl: String? = null,
    val lanCertificateFingerprint: String? = null,
)

fun parsePairingInvite(value: String): PairingInvite? {
    val match = Regex("^(?:vetta|agent567)://pair\\?(.+)$").matchEntire(value.trim()) ?: return null
    val values = match.groupValues[1].split('&').mapNotNull {
        val separator = it.indexOf('=')
        if (separator <= 0) null else decode(it.substring(0, separator)) to decode(it.substring(separator + 1))
    }.toMap()
    val relay = values["relay"]?.trimEnd('/')
    val lan = values["lan"]?.trimEnd('/')
    val lanFingerprint = values["lanFingerprint"]?.lowercase()
    val pairingId = values["pairingId"] ?: return null
    val bootstrap = values["bootstrap"] ?: return null
    if (relay != null && !relay.startsWith("https://")) return null
    val pinnedLan = lan?.takeIf {
        it.startsWith("https://") && lanFingerprint?.matches(Regex("[a-f0-9]{64}")) == true
    }
    val effectiveRelay = pinnedLan ?: relay ?: return null
    if (!effectiveRelay.startsWith("https://")) return null
    if (!pairingId.matches(Regex("[A-Za-z0-9_-]{24,128}"))) return null
    if (!bootstrap.matches(Regex("[A-Za-z0-9_-]{32,256}"))) return null
    return PairingInvite(
        relayBaseUrl = relay ?: effectiveRelay,
        pairingId = pairingId,
        bootstrapSecret = bootstrap,
        lanBaseUrl = pinnedLan,
        lanCertificateFingerprint = lanFingerprint?.takeIf { pinnedLan != null },
    )
}

fun buildMobileBootstrapTarget(invite: PairingInvite, resumeSecret: String): String {
    val socketBase = invite.relayBaseUrl.replaceFirst("https://", "wss://")
    val pin = invite.lanCertificateFingerprint?.let { "&fingerprint=$it" }.orEmpty()
    return "$socketBase/v1/relay/${invite.pairingId}/mobile#pairing=${encode(invite.bootstrapSecret)}&resume=${encode(resumeSecret)}$pin"
}

fun buildMobileResumeTarget(invite: PairingInvite, resumeSecret: String): String {
    val socketBase = invite.relayBaseUrl.replaceFirst("https://", "wss://")
    val pin = invite.lanCertificateFingerprint?.let { "&fingerprint=$it" }.orEmpty()
    return "$socketBase/v1/relay/${invite.pairingId}/mobile#pairing=${encode(resumeSecret)}$pin"
}

private fun encode(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")
private fun decode(value: String): String = java.net.URLDecoder.decode(value, "UTF-8")
