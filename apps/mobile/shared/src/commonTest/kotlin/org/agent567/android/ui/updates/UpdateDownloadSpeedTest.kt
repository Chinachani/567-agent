package org.agent567.android.ui.updates

import kotlin.test.Test
import kotlin.test.assertEquals
import org.agent567.android.ui.i18n.Str

class UpdateDownloadSpeedTest {
    @Test fun lowSpeedsRemainVisibleAndUnitsChangeAtTheirThresholds() {
        for ((bytes, expected) in listOf(
            -1L to "0 B/s", 0L to "0 B/s", 512L to "512 B/s", 1024L to "1.0 KB/s",
            2048L to "2.0 KB/s", 68_300L to "66.6 KB/s",
            1_048_575L to "1023.9 KB/s", 1_048_576L to "1.0 MB/s",
            1_572_864L to "1.5 MB/s",
        )) assertEquals(expected, Str.updateDownloadSpeed(bytes))
    }
}
