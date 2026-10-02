package org.agent567.android.data.session

import org.agent567.android.domain.session.SessionStore

const val MIGRATION_BACKUP_MAX_BYTES = 200 * 1024 * 1024
val MIGRATION_BACKUP_LIMIT_OPTIONS_MB = listOf(50, 100, 200)

class MigrationBackupTooLargeException(
    val actualBytes: Long,
    val limitBytes: Long,
) : IllegalArgumentException()

class SessionMigrationBackup(
    private val sessionStore: SessionStore,
) {
    suspend fun export(passphrase: String, limitMb: Int = 50): ByteArray {
        require(passphrase.length in MIN_PASSPHRASE_LENGTH..MAX_PASSPHRASE_LENGTH) { "密码长度需为 $MIN_PASSPHRASE_LENGTH 到 $MAX_PASSPHRASE_LENGTH 个字符" }
        require(limitMb in MIGRATION_BACKUP_LIMIT_OPTIONS_MB) { "不支持的迁移备份上限" }
        val limitBytes = limitMb * 1024L * 1024L
        val json = sessionStore.exportMigrationData().encodeToByteArray()
        return try {
            if (json.size > limitBytes) throw MigrationBackupTooLargeException(json.size.toLong(), limitBytes)
            val archive = encryptMigrationPayload(json, passphrase)
            if (archive.size > limitBytes) {
                archive.fill(0)
                throw MigrationBackupTooLargeException(archive.size.toLong(), limitBytes)
            }
            archive
        } finally {
            json.fill(0)
        }
    }

    suspend fun import(archive: ByteArray, passphrase: String): Int {
        require(passphrase.length in MIN_PASSPHRASE_LENGTH..MAX_PASSPHRASE_LENGTH) { "密码长度需为 $MIN_PASSPHRASE_LENGTH 到 $MAX_PASSPHRASE_LENGTH 个字符" }
        if (archive.size > MIGRATION_BACKUP_MAX_BYTES) {
            throw MigrationBackupTooLargeException(archive.size.toLong(), MIGRATION_BACKUP_MAX_BYTES.toLong())
        }
        val plaintext = decryptMigrationPayload(archive, passphrase)
        return try {
            if (plaintext.size > MIGRATION_BACKUP_MAX_BYTES) {
                throw MigrationBackupTooLargeException(plaintext.size.toLong(), MIGRATION_BACKUP_MAX_BYTES.toLong())
            }
            sessionStore.importMigrationData(plaintext.decodeToString(throwOnInvalidSequence = true))
        } finally {
            plaintext.fill(0)
        }
    }

    private companion object {
        const val MIN_PASSPHRASE_LENGTH = 8
        const val MAX_PASSPHRASE_LENGTH = 128
    }
}

internal expect fun encryptMigrationPayload(plaintext: ByteArray, passphrase: String): ByteArray

internal expect fun decryptMigrationPayload(archive: ByteArray, passphrase: String): ByteArray
