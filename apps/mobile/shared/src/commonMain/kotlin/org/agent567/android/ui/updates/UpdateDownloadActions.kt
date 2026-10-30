package org.agent567.android.ui.updates

import androidx.compose.runtime.Composable
import kotlinx.coroutines.flow.StateFlow
import org.agent567.android.core.api.AppUpdateCheckResult

enum class UpdateDownloadPhase { Idle, Downloading, Pausing, Paused, Verifying, Ready, Error }

data class UpdateDownloadState(
    val phase: UpdateDownloadPhase = UpdateDownloadPhase.Idle,
    val version: String = "",
    val downloadedBytes: Long = 0,
    val totalBytes: Long = 0,
    val error: String? = null,
    val bytesPerSecond: Long = 0,
)

interface UpdateDownloadActions {
    val state: StateFlow<UpdateDownloadState>
    fun start(update: AppUpdateCheckResult)
    fun pause()
    fun resume()
    fun install()
}

@Composable
expect fun rememberUpdateDownloadActions(): UpdateDownloadActions
