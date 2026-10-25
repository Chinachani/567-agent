package org.agent567.android.domain.remote

import org.agent567.android.ui.remote.androidRemoteKeyCode
import org.agent567.android.core.api.isPaymentUnavailable
import kotlin.test.*

class RemoteKeyboardHostTest {
    @Test fun mapsNativeShortcutsAndModifiersWithoutForwardingNavigationBack() {
        assertEquals("ControlLeft", androidRemoteKeyCode(113))
        assertEquals("KeyC", androidRemoteKeyCode(31))
        assertEquals("Enter", androidRemoteKeyCode(66))
        assertEquals("Escape", androidRemoteKeyCode(111))
        assertEquals("ShiftRight", androidRemoteKeyCode(60))
        assertNull(androidRemoteKeyCode(4))
    }
    @Test fun paymentClosureIsDistinctFromAuthenticationAndNetworkFailure() {
        assertTrue(isPaymentUnavailable("支付通道未开启"))
        assertTrue(isPaymentUnavailable("在线支付暂未开放"))
        assertFalse(isPaymentUnavailable("HTTP 403"))
        assertFalse(isPaymentUnavailable("网络连接失败"))
    }
}
