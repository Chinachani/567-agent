package org.agent567.android.ui

import org.agent567.android.ui.me.usernameInitial
import kotlin.test.Test
import kotlin.test.assertEquals

class UsernameInitialTest {
    @Test fun accountInitialUsesACompleteFirstCharacter() {
        assertEquals("夜", usernameInitial(" 夜雨寄北 "))
        assertEquals("A", usernameInitial("alice"))
        assertEquals("😀", usernameInitial("😀name"))
        assertEquals("?", usernameInitial("  "))
    }
}
