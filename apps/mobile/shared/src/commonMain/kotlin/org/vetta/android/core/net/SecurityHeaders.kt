package org.vetta.android.core.net

import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.random.Random

object SecurityHeaders {
    private val SALT_PARTS = listOf("567", "Api", "Secure", "Token", "2026", "AntiLeech", "v1")
    private val CLIENT_SECRET_KEY: String by lazy {
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(SALT_PARTS.joinToString("::#@!").toByteArray(Charsets.UTF_8))
        digest.joinToString("") { "%02x".format(it) }
    }

    fun generate(deviceId: String, extraContext: Map<String, String> = emptyMap()): Map<String, String> {
        val timestamp = (System.currentTimeMillis() / 1000).toString()
        val nonce = Random.nextBytes(8).joinToString("") { "%02x".format(it) }
        val clientVersion = "1.0.0"

        val signPayload = "$deviceId:$timestamp:$nonce:$clientVersion"
        val signature = hmacSha256(CLIENT_SECRET_KEY, signPayload)

        val headers = mutableMapOf(
            "X-567-Client" to "567-Agent-Desktop",
            "X-567-Version" to clientVersion,
            "X-567-Device-Id" to deviceId,
            "X-567-Timestamp" to timestamp,
            "X-567-Nonce" to nonce,
            "X-567-Signature" to signature,
        )

        for ((k, v) in extraContext) {
            headers[k] = v
        }

        return headers
    }

    private fun hmacSha256(key: String, data: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        val secretKey = SecretKeySpec(key.toByteArray(Charsets.UTF_8), "HmacSHA256")
        mac.init(secretKey)
        val hmac = mac.doFinal(data.toByteArray(Charsets.UTF_8))
        return hmac.joinToString("") { "%02x".format(it) }
    }
}
