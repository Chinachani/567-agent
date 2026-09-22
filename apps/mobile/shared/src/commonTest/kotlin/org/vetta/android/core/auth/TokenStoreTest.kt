package org.vetta.android.core.auth

import com.russhwolf.settings.MapSettings
import kotlin.test.Test
import kotlin.test.assertEquals

class TokenStoreTest {
    @Test
    fun testSettingsTokenStorePersistenceAcrossInstances() {
        val settings = MapSettings()
        val store1 = SettingsTokenStore(settings)
        store1.save("token_123456", "token_123456")
        assertEquals("token_123456", store1.accessToken)

        // 模拟同一个 Settings 下的新 Store 实例
        val store2 = SettingsTokenStore(settings)
        assertEquals("token_123456", store2.accessToken, "store2 should read persisted token")
        assertEquals("token_123456", store2.refreshToken)

        // 测试 clear
        store2.clear()
        val store3 = SettingsTokenStore(settings)
        assertEquals(null, store3.accessToken)
        assertEquals(null, store3.refreshToken)
    }

    @Test
    fun testSettingsTokenStoreFallsBackToPrefToken() {
        val settings = MapSettings()
        settings.putString("vetta.prefs.auth_token", "fallback_token_888")
        val store = SettingsTokenStore(settings)
        assertEquals("fallback_token_888", store.accessToken)
        assertEquals("fallback_token_888", store.refreshToken)
    }
}
