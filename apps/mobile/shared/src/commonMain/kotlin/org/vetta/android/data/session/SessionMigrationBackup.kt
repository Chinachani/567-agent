package org.vetta.android.data.session

import org.vetta.android.domain.session.SessionStore

class SessionMigrationBackup(
    private val sessionStore: SessionStore,
) {
    suspend fun export(passphrase: String): ByteArray {
        require(passphrase.length in MIN_PASSPHRASE_LENGTH..MAX_PASSPHRASE_LENGTH) { "密码长度需为 $MIN_PASSPHRASE_LENGTH 到 $MAX_PASSPHRASE_LENGTH 个字符" }
        val json = sessionStore.exportMigrationData().encodeToByteArray()
        require(json.size <= MAX_ARCHIVE_BYTES) { "聊天记录太大，无法打包迁移" }
        return try {
            encryptMigrationPayload(json, passphrase)
        } finally {
            json.fill(0)
        }
    }

    suspend fun import(archive: ByteArray, passphrase: String): Int {
        require(passphrase.length in MIN_PASSPHRASE_LENGTH..MAX_PASSPHRASE_LENGTH) { "密码长度需为 $MIN_PASSPHRASE_LENGTH 到 $MAX_PASSPHRASE_LENGTH 个字符" }
        require(archive.size <= MAX_ARCHIVE_BYTES) { "迁移文件过大" }
        val plaintext = decryptMigrationPayload(archive, passphrase)
        return try {
            require(plaintext.size <= MAX_ARCHIVE_BYTES) { "迁移文件解压后过大" }
            sessionStore.importMigrationData(plaintext.decodeToString(throwOnInvalidSequence = true))
        } finally {
            plaintext.fill(0)
        }
    }

    private companion object {
        const val MIN_PASSPHRASE_LENGTH = 8
        const val MAX_PASSPHRASE_LENGTH = 128
        const val MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
    }
}

internal expect fun encryptMigrationPayload(plaintext: ByteArray, passphrase: String): ByteArray

internal expect fun decryptMigrationPayload(archive: ByteArray, passphrase: String): ByteArray
