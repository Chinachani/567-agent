package org.agent567.android.app

import com.russhwolf.settings.MapSettings
import kotlin.test.Test
import kotlin.test.assertEquals

class AppPreferencesTest {
    @Test
    fun autoResumeLastSessionIsOffForNewInstalls() {
        assertEquals(false, AppPreferences(MapSettings()).autoResumeLastSession.value)
    }

    @Test
    fun imageGenerationIsEnabledByDefault() {
        assertEquals(true, AppPreferences(MapSettings()).imageGenEnabled)
    }

    @Test
    fun newInstallUsesLightThemeByDefault() {
        assertEquals(ThemeMode.Light, AppPreferences(MapSettings()).themeMode.value)
    }

    @Test
    fun productPreferencesPersistBehaviorChoices() {
        val preferences = AppPreferences(MapSettings())

        preferences.setAutoResumeLastSession(false)
        preferences.setMotionEnabled(false)
        preferences.setConfirmBeforeDelete(false)

        assertEquals(false, preferences.autoResumeLastSession.value)
        assertEquals(false, preferences.motionEnabled.value)
        assertEquals(false, preferences.confirmBeforeDelete.value)
    }

    @Test
    fun booleanPreferencesReadExistingTypedValues() {
        val settings = MapSettings()
        settings.putBoolean("vetta.prefs.auto_resume", false)
        settings.putBoolean("vetta.prefs.motion_enabled", false)
        settings.putBoolean("vetta.prefs.confirm_delete", false)

        val preferences = AppPreferences(settings)

        assertEquals(false, preferences.autoResumeLastSession.value)
        assertEquals(false, preferences.motionEnabled.value)
        assertEquals(false, preferences.confirmBeforeDelete.value)
    }

    @Test
    fun booleanPreferencesStillReadLegacyStringValues() {
        val settings = MapSettings()
        settings.putString("vetta.prefs.auto_resume", "false")

        assertEquals(false, AppPreferences(settings).autoResumeLastSession.value)
    }

    @Test fun modelProtocolSurvivesRestartAndIsIsolatedFromOtherModelsGroupsAndServices() {
        val storage = MapSettings()
        val prefs = AppPreferences(storage)
        prefs.setModelContextOverride("Codex", "gpt-5", 64000)
        prefs.setModelInferenceApi("Codex", "gpt-5", org.agent567.android.core.chat.InferenceApi.Completions)
        val restored = AppPreferences(storage)
        assertEquals(org.agent567.android.core.chat.InferenceApi.Completions, restored.getModelInferenceApi("Codex", "gpt-5"))
        assertEquals(null, restored.getModelInferenceApi("Other", "gpt-5"))
        assertEquals(null, restored.getModelInferenceApi("Codex", "other"))
        restored.setServerUrl("https://custom.example/api/v1")
        assertEquals(null, restored.getModelInferenceApi("Codex", "gpt-5"))
        restored.setServerUrl(prefs.serverUrl.value)
        restored.setModelInferenceApi("Codex", "gpt-5", null)
        assertEquals(null, AppPreferences(storage).getModelInferenceApi("Codex", "gpt-5"))
        assertEquals(64000L, restored.getModelContextOverride("Codex", "gpt-5"))
    }
}
