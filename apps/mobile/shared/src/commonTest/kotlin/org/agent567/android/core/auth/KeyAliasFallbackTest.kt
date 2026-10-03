package org.agent567.android.core.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class KeyAliasFallbackTest {
    @Test
    fun currentAliasWinsWithoutTouchingLegacyKey() {
        var legacyRead = false
        var migrated = false

        val value = decryptWithLegacyKeystoreAlias(
            decryptCurrent = { "current" },
            decryptLegacy = { legacyRead = true; "legacy" },
            migrate = { migrated = true },
        )

        assertEquals("current", value)
        kotlin.test.assertFalse(legacyRead)
        kotlin.test.assertFalse(migrated)
    }

    @Test
    fun legacyValueIsReturnedAndReencryptedWithCurrentAlias() {
        var migratedValue: String? = null

        val value = decryptWithLegacyKeystoreAlias(
            decryptCurrent = { null },
            decryptLegacy = { "saved-account" },
            migrate = { migratedValue = it },
        )

        assertEquals("saved-account", value)
        assertEquals("saved-account", migratedValue)
    }

    @Test
    fun failedReencryptionDoesNotDiscardReadableLegacyValue() {
        val value = decryptWithLegacyKeystoreAlias(
            decryptCurrent = { null },
            decryptLegacy = { "saved-account" },
            migrate = { error("new keystore unavailable") },
        )

        assertEquals("saved-account", value)
    }

    @Test
    fun missingAliasesReturnNullWithoutInventingData() {
        val value = decryptWithLegacyKeystoreAlias(
            decryptCurrent = { null },
            decryptLegacy = { null },
            migrate = { error("must not be called") },
        )

        assertNull(value)
    }

    @Test
    fun plaintextMigrationFailureKeepsTheSecretReadableForRetry() {
        var attemptedValue: String? = null
        val value = migratePlaintextSecret("legacy-password") {
            attemptedValue = it
            error("Keystore unavailable")
        }

        assertEquals("legacy-password", attemptedValue)
        assertEquals("legacy-password", value)
    }
}
