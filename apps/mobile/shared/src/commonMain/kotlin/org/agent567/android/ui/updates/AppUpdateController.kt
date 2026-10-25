package org.agent567.android.ui.updates

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.agent567.android.AppVersion
import org.agent567.android.app.AppPreferences
import org.agent567.android.core.api.AppUpdateCheckResult
import org.agent567.android.ui.i18n.Str

data class AppUpdateState(val checking: Boolean = false, val result: AppUpdateCheckResult? = null, val prompt: Boolean = false)

/** Shared automatic/manual check owner. Background failures stay quiet; notices are per version. */
class AppUpdateController(
    private val preferences: AppPreferences,
    private val fetch: suspend () -> AppUpdateCheckResult,
    private val now: () -> Long = { System.currentTimeMillis() },
) {
    private val mutex = Mutex()
    private val mutable = MutableStateFlow(AppUpdateState(result = preferences.availableUpdateVersion.takeIf {
        it.isNotBlank() && preferences.updateCheckedForVersion == AppVersion.NAME
    }?.let { AppUpdateCheckResult(true, it, "v${AppVersion.NAME}", "", null) }))
    val state = mutable.asStateFlow()

    suspend fun check(automatic: Boolean): AppUpdateCheckResult? = mutex.withLock {
        val time = now()
        val previous = preferences.lastUpdateCheckAt
        if (automatic && preferences.updateCheckedForVersion == AppVersion.NAME && previous > 0 && time >= previous && time - previous < 6 * 60 * 60 * 1000L) return@withLock mutable.value.result
        if (preferences.updateCheckedForVersion != AppVersion.NAME) preferences.availableUpdateVersion = ""
        preferences.lastUpdateCheckAt = time
        preferences.updateCheckedForVersion = AppVersion.NAME
        mutable.value = mutable.value.copy(checking = true)
        try {
            val result = fetch()
            if (result.error == null) {
                preferences.updateCheckedForVersion = AppVersion.NAME
                preferences.availableUpdateVersion = if (result.hasUpdate) result.latestVersion else ""
            }
            val show = automatic && result.hasUpdate && preferences.notifiedUpdateVersion != result.latestVersion
            if (show) preferences.notifiedUpdateVersion = result.latestVersion
            mutable.value = AppUpdateState(result = if (result.error != null) mutable.value.result else result, prompt = show || mutable.value.prompt)
            result
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            AppUpdateCheckResult(false, "v${AppVersion.NAME}", "v${AppVersion.NAME}", "", null, Str.updateCheckFailed)
        } finally {
            mutable.value = mutable.value.copy(checking = false)
        }
    }

    fun dismiss() { mutable.value = mutable.value.copy(prompt = false) }
}
