package org.agent567.android.ui.formatting

import org.agent567.android.ui.i18n.Str

/** Display helpers keep unknown values distinct from zero and permit context usage above 100%. */
fun formatElapsedDuration(durationMs: Long): String {
    val totalSeconds = (durationMs.coerceAtLeast(0) / 1_000).coerceAtLeast(1)
    val hours = totalSeconds / 3_600
    val minutes = (totalSeconds % 3_600) / 60
    val seconds = totalSeconds % 60
    return when {
        hours > 0 -> Str.durationHoursMinutes(hours, minutes)
        minutes > 0 -> Str.durationMinutesSeconds(minutes, seconds)
        else -> Str.durationSeconds(seconds)
    }
}

fun formatContextPercent(percent: Int?): String = percent?.coerceAtLeast(0)?.let { "$it%" } ?: Str.contextUnknown

fun formatContextRatio(tokens: Long?, capacity: Long?): String =
    if (tokens == null || capacity == null || capacity <= 0) Str.contextUnknown
    else formatContextPercent((tokens.coerceAtLeast(0).toDouble() / capacity * 100).coerceAtMost(Int.MAX_VALUE.toDouble()).toInt())

fun formatRelativeTime(epochMs: Long, nowMs: Long): String {
    val minutes = ((nowMs.coerceAtLeast(0) - epochMs.coerceAtLeast(0)).coerceAtLeast(0)) / 60_000
    return when {
        minutes < 1 -> Str.justNow
        minutes < 60 -> Str.minutesAgo(minutes)
        minutes < 60 * 24 -> Str.hoursAgo(minutes / 60)
        else -> Str.daysAgo(minutes / (60 * 24))
    }
}
