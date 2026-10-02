package org.agent567.android.core.auth

/**
 * Reads with the current key first, then migrates a value readable only by the
 * previous key alias. A failed re-encryption does not discard the recovered value.
 */
internal fun decryptWithLegacyKeystoreAlias(
    decryptCurrent: () -> String?,
    decryptLegacy: () -> String?,
    migrate: (String) -> Unit,
): String? {
    decryptCurrent()?.let { return it }
    val legacyValue = decryptLegacy() ?: return null
    runCatching { migrate(legacyValue) }
    return legacyValue
}
