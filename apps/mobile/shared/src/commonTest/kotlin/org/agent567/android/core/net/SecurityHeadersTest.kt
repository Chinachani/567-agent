package org.agent567.android.core.net

import kotlin.test.Test
import kotlin.test.assertEquals

class SecurityHeadersTest {
    @Test
    fun identifiesRequestsAsAndroidClients() {
        assertEquals("567-Agent-Android", SecurityHeaders.generate("device-1")["X-567-Client"])
    }
}
