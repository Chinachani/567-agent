package org.agent567.android.data.session

import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

private val MAGIC = "567CHATBACKUP1".encodeToByteArray()
private const val SALT_SIZE = 16
private const val NONCE_SIZE = 12
private const val TAG_SIZE_BITS = 128
private const val KDF_ITERATIONS = 600_000

internal actual fun encryptMigrationPayload(plaintext: ByteArray, passphrase: String): ByteArray {
    val salt = ByteArray(SALT_SIZE).also(SecureRandom()::nextBytes)
    val nonce = ByteArray(NONCE_SIZE).also(SecureRandom()::nextBytes)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, deriveKey(passphrase, salt), GCMParameterSpec(TAG_SIZE_BITS, nonce))
    val encrypted = cipher.doFinal(plaintext)
    return MAGIC + salt + nonce + encrypted
}

internal actual fun decryptMigrationPayload(archive: ByteArray, passphrase: String): ByteArray {
    val headerSize = MAGIC.size + SALT_SIZE + NONCE_SIZE
    require(archive.size > headerSize + TAG_SIZE_BITS / 8) { "迁移文件不完整" }
    require(archive.copyOfRange(0, MAGIC.size).contentEquals(MAGIC)) { "这不是 567 Agent 聊天记录迁移文件" }
    var offset = MAGIC.size
    val salt = archive.copyOfRange(offset, offset + SALT_SIZE)
    offset += SALT_SIZE
    val nonce = archive.copyOfRange(offset, offset + NONCE_SIZE)
    offset += NONCE_SIZE
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, deriveKey(passphrase, salt), GCMParameterSpec(TAG_SIZE_BITS, nonce))
    return try {
        cipher.doFinal(archive, offset, archive.size - offset)
    } catch (error: Exception) {
        throw IllegalArgumentException("密码错误或迁移文件已损坏", error)
    }
}

internal actual fun runtimeMigrationByteLimit(absoluteLimit: Int): Int {
    // Export/import temporarily hold the serialized model, plaintext and cipher
    // output together. Keep this work below roughly one eighth of the VM heap.
    val heapSafeLimit = (Runtime.getRuntime().maxMemory() / 8L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
    return minOf(absoluteLimit, heapSafeLimit)
}

private fun deriveKey(passphrase: String, salt: ByteArray): SecretKeySpec {
    val passwordBytes = passphrase.encodeToByteArray()
    return try {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(passwordBytes, "HmacSHA256"))
        val block = salt + byteArrayOf(0, 0, 0, 1)
        var u = mac.doFinal(block)
        val derived = u.copyOf()
        repeat(KDF_ITERATIONS - 1) {
            u = mac.doFinal(u)
            for (index in derived.indices) derived[index] = (derived[index].toInt() xor u[index].toInt()).toByte()
        }
        val key = SecretKeySpec(derived, "AES")
        derived.fill(0)
        u.fill(0)
        key
    } finally {
        passwordBytes.fill(0)
    }
}
