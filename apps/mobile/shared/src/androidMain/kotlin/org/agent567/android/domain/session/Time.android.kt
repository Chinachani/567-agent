package org.agent567.android.domain.session

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

actual fun nowEpochMs(): Long = System.currentTimeMillis()

actual fun formatLocalMessageTime(epochMs: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(epochMs))
