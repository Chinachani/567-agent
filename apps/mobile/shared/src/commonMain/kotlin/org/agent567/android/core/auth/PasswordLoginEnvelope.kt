package org.agent567.android.core.auth

import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.interfaces.RSAPublicKey
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import kotlin.io.encoding.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import org.agent567.android.core.api.NewApiLoginRequestDto
import org.agent567.android.core.error.Agent567Exception

/** New API rc.45 envelope: RSA-OAEP/SHA256 wraps AES-256-GCM with the protocol's labels. */
internal fun passwordLoginEnvelope(username: String, password: String, status: Int, response: JsonObject?): NewApiLoginRequestDto {
    if (status == 404 || status == 405) return NewApiLoginRequestDto(username, password)
    fun invalid(): Nothing = throw Agent567Exception.Protocol("无法验证登录加密配置，请稍后重试")
    if (status != 200 || (response?.get("success") as? JsonPrimitive)?.booleanOrNull != true) invalid()
    val config = response?.get("data") as? JsonObject ?: invalid()
    val enabled = (config["enabled"] as? JsonPrimitive)?.booleanOrNull ?: invalid()
    if (!enabled) return NewApiLoginRequestDto(username, password)
    val kid = (config["kid"] as? JsonPrimitive)?.content ?: invalid()
    val pem = (config["public_key"] as? JsonPrimitive)?.content ?: invalid()
    if (!Regex("[a-f0-9]{32}").matches(kid) || pem.length > 16_384) invalid()
    try {
        val der = Base64.decode(pem.trim().removePrefix("-----BEGIN PUBLIC KEY-----").removeSuffix("-----END PUBLIC KEY-----").replace(Regex("\\s"), ""))
        val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der)) as? RSAPublicKey ?: invalid()
        val digest = MessageDigest.getInstance("SHA-256").digest(der).take(16).joinToString("") { "%02x".format(it.toInt() and 255) }
        if (publicKey.modulus.bitLength() < 2048 || digest != kid) invalid()
        val random = SecureRandom()
        val key = ByteArray(32).also(random::nextBytes)
        val nonce = ByteArray(12).also(random::nextBytes)
        try {
            val aes = Cipher.getInstance("AES/GCM/NoPadding")
            aes.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            aes.updateAAD("password-v2:$kid".toByteArray(Charsets.UTF_8))
            val ciphertext = aes.doFinal(password.toByteArray(Charsets.UTF_8))
            val rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
            rsa.init(Cipher.ENCRYPT_MODE, publicKey, OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified("password-v2".toByteArray(Charsets.UTF_8))))
            val encoded = listOf(rsa.doFinal(key), nonce, ciphertext).joinToString(".") { Base64.encode(it) }
            return NewApiLoginRequestDto(username = username, passwordEncrypted = "v2.$encoded", encryptionKeyId = kid)
        } finally { key.fill(0) }
    } catch (error: Agent567Exception) { throw error }
    catch (_: Exception) { invalid() }
}
