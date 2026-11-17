package org.agent567.android.ui.remote

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.ActivityInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext

@Composable
internal fun RemoteFullscreenOrientation(lockLandscape: Boolean = true) {
    val activity = LocalContext.current.findActivity()
    DisposableEffect(activity, lockLandscape) {
        if (!lockLandscape || activity == null) return@DisposableEffect onDispose {}
        val previous = activity.requestedOrientation
        // Explicit landscape works even when the user's system auto-rotation is locked.
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        onDispose { activity.requestedOrientation = previous }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
