package org.agent567.android.ui

import kotlin.test.Test
import kotlin.test.assertEquals

class MotionPreferenceTest {
    @Test
    fun disabledMotionUsesImmediateStateChanges() {
        assertEquals(0, optionalMotionDuration(false, 200))
        assertEquals(200, optionalMotionDuration(true, 200))
    }
}
