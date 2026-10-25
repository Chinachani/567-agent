package org.agent567.android.core.settings

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.runBlocking
import org.agent567.android.app.AppPreferences
import org.agent567.android.app.ThemeMode
import org.agent567.android.core.auth.SettingsTokenStore
import org.agent567.android.data.session.SettingsSessionStore
import kotlin.test.*

class BrandPersistenceFlowTest {
    @Test fun migratesTypedPreferencesWithoutOverwritingNewValues() {
        val raw = MapSettings().apply {
            putString("vetta.prefs.theme", "Dark")
            putBoolean("vetta.prefs.confirm_delete", false)
            putString("vetta.prefs.server_url", "https://api.567.wiki")
        }
        val preferences = AppPreferences(raw)
        assertEquals(ThemeMode.Dark, preferences.themeMode.value)
        assertFalse(preferences.confirmBeforeDelete.value)
        preferences.setThemeMode(ThemeMode.Light)
        raw.putString("vetta.prefs.theme", "Dark") // stale legacy data must lose to the current value
        assertEquals(ThemeMode.Light, AppPreferences(raw).themeMode.value)
        assertEquals("Light", raw.getStringOrNull("agent567.prefs.theme"))
        val settings = Agent567Settings(raw)
        raw.putLong("vetta.long", 123L)
        raw.putInt("vetta.int", 12)
        raw.putFloat("vetta.float", 1.25f)
        raw.putDouble("vetta.double", 2.5)
        assertEquals(123L, settings.getLong("agent567.long", 0))
        assertEquals(12, settings.getInt("agent567.int", 0))
        assertEquals(1.25f, settings.getFloat("agent567.float", 0f))
        assertEquals(2.5, settings.getDouble("agent567.double", 0.0))
    }
    @Test fun logoutRemovesLegacyAndCurrentTokensWithoutResurrection() {
        val raw = MapSettings().apply {
            putString("vetta.access_token", "legacy-access")
            putString("vetta.refresh_token", "legacy-refresh")
            putString("vetta.prefs.auth_token", "legacy-access")
            putString("vetta.prefs.auth_refresh_token", "legacy-refresh")
        }
        val tokens = SettingsTokenStore(raw)
        assertEquals("legacy-access", tokens.accessToken)
        tokens.save("current-access", "current-refresh")
        assertEquals("current-access", SettingsTokenStore(raw).accessToken)
        tokens.clear()
        assertNull(SettingsTokenStore(raw).snapshot())
        assertTrue(raw.keys.none { it.contains("token") })
    }
    @Test fun legacyHistoryCanBeReadThenDeletedWithoutReappearing() = runBlocking {
        val raw = MapSettings().apply {
            putString("vetta.session.index", """{"items":[{"id":"legacy","title":"Old","createdAtEpochMs":1,"updatedAtEpochMs":2}]}""")
            putString("vetta.session.messages.legacy", """{"items":[{"id":"m","sessionId":"legacy","role":"user","content":"Hello","status":"Complete","createdAtEpochMs":1}]}""")
        }
        val sessions = SettingsSessionStore(raw)
        assertEquals("Hello", sessions.getMessages("legacy").single().content)
        sessions.deleteSession("legacy")
        val reopened = SettingsSessionStore(raw)
        assertNull(reopened.getSession("legacy"))
        assertTrue(reopened.getMessages("legacy").isEmpty())
        assertTrue(raw.keys.none { it.startsWith("vetta.session.") })
    }
}
