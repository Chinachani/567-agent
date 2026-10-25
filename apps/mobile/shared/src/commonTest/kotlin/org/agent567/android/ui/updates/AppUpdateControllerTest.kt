package org.agent567.android.ui.updates

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.async
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runTest
import org.agent567.android.app.AppPreferences
import org.agent567.android.core.api.AppUpdateCheckResult
import kotlin.test.*

class AppUpdateControllerTest {
    @Test fun startupChecksOnceShowsANoticeAndPersistsTheBadgeAcrossRecreation() = runTest {
        val settings = MapSettings()
        var calls = 0
        var time = 1000L
        val response = AppUpdateCheckResult(true, "v9.0.0", "v1.3.3", "notes", null)
        val controller = AppUpdateController(AppPreferences(settings), { calls++; response }, { time })
        controller.check(true)
        assertTrue(controller.state.value.prompt)
        controller.dismiss()
        controller.check(true)
        assertEquals(1, calls)
        val recreated = AppUpdateController(AppPreferences(settings), { calls++; response }, { time })
        assertTrue(recreated.state.value.result?.hasUpdate == true)
        assertFalse(recreated.state.value.prompt)
        time += 6 * 60 * 60 * 1000L
        recreated.check(true)
        assertEquals(2, calls)
        assertFalse(recreated.state.value.prompt)
        recreated.check(false)
        assertEquals(3, calls)
    }

    @Test fun concurrentAutomaticChecksShareTheResultAndFailureRemainsQuietAndRetryable() = runTest {
        val preferences = AppPreferences(MapSettings())
        val gate = CompletableDeferred<Unit>()
        var calls = 0
        var failure = true
        val controller = AppUpdateController(preferences, {
            calls++; gate.await()
            if (failure) AppUpdateCheckResult(false, "", "", "", null, "offline")
            else AppUpdateCheckResult(true, "v9", "v1", "", null)
        }, { 1000 })
        val a = async { controller.check(true) }
        val b = async { controller.check(true) }
        gate.complete(Unit); a.await(); b.await()
        assertEquals(1, calls)
        assertFalse(controller.state.value.prompt)
        assertFalse(controller.state.value.checking)
        failure = false
        controller.check(false)
        assertTrue(controller.state.value.result?.hasUpdate == true)
        assertFalse(controller.state.value.prompt)
    }
}
