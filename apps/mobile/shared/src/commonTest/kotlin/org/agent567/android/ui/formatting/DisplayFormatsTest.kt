package org.agent567.android.ui.formatting

import kotlin.test.Test
import kotlin.test.assertEquals

class DisplayFormatsTest {
    @Test fun formatsUnknownOverflowAndFutureValuesConsistently() {
        assertEquals("1分5秒", formatElapsedDuration(65_000))
        assertEquals("1时1分", formatElapsedDuration(3_660_000))
        assertEquals("1秒", formatElapsedDuration(-1))
        assertEquals("125%", formatContextRatio(125, 100))
        assertEquals("2147483647%", formatContextRatio(Long.MAX_VALUE, 1))
        assertEquals(org.agent567.android.ui.i18n.Str.contextUnknown, formatContextRatio(1, null))
        assertEquals(org.agent567.android.ui.i18n.Str.contextUnknown, formatContextPercent(null))
        assertEquals("刚刚", formatRelativeTime(100, 0))
        assertEquals("1 小时前", formatRelativeTime(0, 3_600_000))
    }
}
