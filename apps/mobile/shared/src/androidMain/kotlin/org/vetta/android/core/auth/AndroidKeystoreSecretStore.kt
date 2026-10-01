package org.vetta.android.core.auth

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.russhwolf.settings.Settings
import com.russhwolf.settings.set
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

actual fun createPlatformSecretStore(settings: Settings): SecretStore = AndroidKeystoreSecretStore(settings)

private class AndroidKeystoreSecretStore(private val settings: Settings) : SecretStore {
    @Synchronized
    override fun get(key: String): String? {
        val stored = settings.getStringOrNull(key) ?: return null
        if (!stored.startsWith(PREFIX)) {
            try {
                put(key, stored)
            } catch (_: Exception) {
                settings.remove(key)
                return null
            }
            return stored
        }
        val parts = stored.removePrefix(PREFIX).split(':', limit = 2)
        if (parts.size != 2) {
            settings.remove(key)
            return null
        }
        return try {
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val ciphertext = Base64.decode(parts[1], Base64.NO_WRAP)
            Cipher.getInstance(TRANSFORMATION).run {
                init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_LENGTH_BITS, iv))
                doFinal(ciphertext).toString(Charsets.UTF_8)
            }
        } catch (_: Exception) {
            settings.remove(key)
            null
        }
    }

    @Synchronized
    override fun put(key: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
        val ciphertext = Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        settings[key] = "$PREFIX$iv:$ciphertext"
    }

    @Synchronized
    override fun remove(key: String) {
        settings.remove(key)
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).run {
            init(
                KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .setRandomizedEncryptionRequired(true)
                    .build(),
            )
            generateKey()
        }
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "org.vetta.android.preferences.v1"
        const val PREFIX = "enc:v1:"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_LENGTH_BITS = 128
    }
}
