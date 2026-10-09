package org.agent567.android.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class Agent567ConfigTest {
    @Test
    fun stripsApiV1ForGateway() {
        val config = Agent567Config("http://example.com:8080/api/v1")
        assertEquals("http://example.com:8080/api/v1", config.apiBaseUrl)
        assertEquals("http://example.com:8080", config.gatewayBaseUrl)
    }

    @Test
    fun trimsTrailingSlash() {
        val config = Agent567Config("http://example.com/api/v1/")
        assertEquals("http://example.com/api/v1", config.apiBaseUrl)
        assertEquals("http://example.com", config.gatewayBaseUrl)
    }

    @Test
    fun handles567ApiUrl() {
        val config = Agent567Config("https://api.567.wiki")
        assertEquals("https://api.567.wiki", config.apiBaseUrl)
        assertEquals("https://api.567.wiki", config.gatewayBaseUrl)
    }

    @Test
    fun rejectsBlank() {
        assertFailsWith<IllegalArgumentException> {
            Agent567Config("  ")
        }
    }
}
