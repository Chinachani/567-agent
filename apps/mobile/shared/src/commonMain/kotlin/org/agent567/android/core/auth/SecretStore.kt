package org.agent567.android.core.auth

import org.agent567.android.core.settings.Agent567Settings
import com.russhwolf.settings.Settings
import com.russhwolf.settings.set

interface SecretStore {
    fun get(key: String): String?
    fun put(key: String, value: String)
    fun remove(key: String)
}

class SettingsSecretStore(settings: Settings) : SecretStore {
    private val settings = Agent567Settings(settings)
    override fun get(key: String): String? = settings.getStringOrNull(key)

    override fun put(key: String, value: String) {
        settings[key] = value
    }

    override fun remove(key: String) {
        settings.remove(key)
    }
}

expect fun createPlatformSecretStore(settings: Settings): SecretStore
