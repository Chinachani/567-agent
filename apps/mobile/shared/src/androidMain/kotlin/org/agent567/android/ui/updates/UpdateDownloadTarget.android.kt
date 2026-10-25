package org.agent567.android.ui.updates

import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

@Composable
actual fun canUseReleaseApk(): Boolean = LocalContext.current.packageName == "com.api567.agent"
