package org.agent567.android.ui

import androidx.compose.runtime.staticCompositionLocalOf

/** Explicitly controls optional notification and waiting animations, not navigation. */
val LocalMotionEnabled = staticCompositionLocalOf { true }

internal fun optionalMotionDuration(enabled: Boolean, duration: Int): Int = if (enabled) duration else 0
