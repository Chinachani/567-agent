package org.agent567.android.domain.session

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

actual fun nowEpochMs(): Long = System.currentTimeMillis()

actual fun formatLocalMessageTime(epochMs: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(epochMs))

internal actual fun localHistoryDays(now: Long): LocalHistoryDays {
    val date = Calendar.getInstance().apply {
        timeInMillis = now
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }
    fun startOfDay(offset: Int) = (date.clone() as Calendar).apply { add(Calendar.DATE, offset) }.timeInMillis
    return LocalHistoryDays(date.timeInMillis, startOfDay(-1), startOfDay(-6), startOfDay(1))
}
