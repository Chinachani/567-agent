package org.vetta.android.core.auth

import com.russhwolf.settings.Settings
import com.russhwolf.settings.set

interface SecretStore {
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun remove(key: String)
}

class SettingsSecretStore(private val settings: Settings) : SecretStore {
    override fun get(key: String): String? = settings.getStringOrNull(key)

    override fun put(key: String, value: String) {
        settings[key] = value
    }

    override fun remove(key: String) {
        settings.remove(key)
    }
}

expect fun createPlatformSecretStore(settings: Settings): SecretStore
