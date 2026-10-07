package org.agent567.android.data.session

import org.agent567.android.domain.session.SessionStore

const val MIGRATION_BACKUP_MAX_BYTES = 200 * 1024 * 1024
val MIGRATION_BACKUP_LIMIT_OPTIONS_MB = listOf(50, 100, 200)

class MigrationBackupTooLargeException(
    val actualBytes: Long,
    val limitBytes: Long,
) : IllegalArgumentException()

data class MigrationBackupProgress(val stage: Stage, val completed: Int = 0, val total: Int = 0) {
    enum class Stage { Collecting, Encrypting, Decrypting, Importing }
}

class SessionMigrationBackup(
    private val sessionStore: SessionStore,
) {
    suspend fun export(
        passphrase: String,
        limitMb: Int = 50,
        onProgress: (MigrationBackupProgress) -> Unit = {},
    ): ByteArray {
        require(passphrase.length in MIN_PASSPHRASE_LENGTH..MAX_PASSPHRASE_LENGTH) { "密码长度需为 $MIN_PASSPHRASE_LENGTH 到 $MAX_PASSPHRASE_LENGTH 个字符" }
        require(limitMb in MIGRATION_BACKUP_LIMIT_OPTIONS_MB) { "不支持的迁移备份上限" }
        val configuredLimitBytes = limitMb * 1024L * 1024L
        val limitBytes = minOf(configuredLimitBytes, runtimeMigrationByteLimit(MIGRATION_BACKUP_MAX_BYTES).toLong())
        onProgress(MigrationBackupProgress(MigrationBackupProgress.Stage.Collecting))
        val json = exportSerializedBytes(limitBytes, onProgress)
        return try {
            if (json.size > limitBytes) throw MigrationBackupTooLargeException(json.size.toLong(), limitBytes)
            onProgress(MigrationBackupProgress(MigrationBackupProgress.Stage.Encrypting))
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

    suspend fun import(
        archive: ByteArray,
        passphrase: String,
        onProgress: (MigrationBackupProgress) -> Unit = {},
    ): Int {
        require(passphrase.length in MIN_PASSPHRASE_LENGTH..MAX_PASSPHRASE_LENGTH) { "密码长度需为 $MIN_PASSPHRASE_LENGTH 到 $MAX_PASSPHRASE_LENGTH 个字符" }
        val safeLimitBytes = runtimeMigrationByteLimit(MIGRATION_BACKUP_MAX_BYTES)
        if (archive.size > safeLimitBytes) {
            archive.fill(0)
            throw MigrationBackupTooLargeException(archive.size.toLong(), safeLimitBytes.toLong())
        }
        onProgress(MigrationBackupProgress(MigrationBackupProgress.Stage.Decrypting))
        val plaintext = try {
            decryptMigrationPayload(archive, passphrase)
        } catch (error: Throwable) {
            archive.fill(0)
            throw error
        }
        return try {
            if (plaintext.size > safeLimitBytes) {
                throw MigrationBackupTooLargeException(plaintext.size.toLong(), safeLimitBytes.toLong())
            }
            onProgress(MigrationBackupProgress(MigrationBackupProgress.Stage.Importing))
            sessionStore.importMigrationData(plaintext.decodeToString(throwOnInvalidSequence = true))
        } finally {
            plaintext.fill(0)
            archive.fill(0)
        }
    }

    private suspend fun exportSerializedBytes(
        limitBytes: Long,
        onProgress: (MigrationBackupProgress) -> Unit,
    ): ByteArray {
        val serialized = sessionStore.exportMigrationData(limitBytes) { completed, total ->
            onProgress(MigrationBackupProgress(MigrationBackupProgress.Stage.Collecting, completed, total))
        }
        val serializedBytes = serialized.utf8ByteCount()
        if (serializedBytes > limitBytes) {
            throw MigrationBackupTooLargeException(serializedBytes, limitBytes)
        }
        return serialized.encodeToByteArray()
    }

    private fun String.utf8ByteCount(): Long {
        var bytes = 0L
        var index = 0
        while (index < length) {
            val char = this[index]
            bytes += when {
                char.code <= 0x7f -> 1
                char.code <= 0x7ff -> 2
                char.isHighSurrogate() && index + 1 < length && this[index + 1].isLowSurrogate() -> {
                    index++
                    4
                }
                else -> 3
            }
            index++
        }
        return bytes
    }

    private companion object {
        const val MIN_PASSPHRASE_LENGTH = 8
        const val MAX_PASSPHRASE_LENGTH = 128
    }
}

internal expect fun encryptMigrationPayload(plaintext: ByteArray, passphrase: String): ByteArray

internal expect fun decryptMigrationPayload(archive: ByteArray, passphrase: String): ByteArray

internal expect fun runtimeMigrationByteLimit(absoluteLimit: Int): Int
