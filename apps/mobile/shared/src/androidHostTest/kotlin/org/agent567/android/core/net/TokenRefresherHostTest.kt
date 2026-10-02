package org.agent567.android.core.net

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.coroutineScope
import org.agent567.android.core.auth.InMemoryTokenStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class TokenRefresherHostTest {
    @Test
    fun concurrentRequestsShareOneRefreshAttempt() = runBlocking {
        val tokens = InMemoryTokenStore("expired-token", "refresh-cookie")
        val started = CompletableDeferred<Unit>()
        val finish = CompletableDeferred<RefreshOutcome>()
        var calls = 0
        val refresher = TokenRefresher(tokens, {
            calls += 1
            started.complete(Unit)
            finish.await()
        }, null)

        coroutineScope {
            val first = async { refresher.refresh("expired-token") }
            started.await()
            val second = async { refresher.refresh("expired-token") }
            val third = async { refresher.refresh("expired-token") }
            finish.complete(RefreshOutcome.Ok("new-token", "new-cookie"))

            assertIs<RefreshOutcome.Ok>(first.await())
            assertIs<RefreshOutcome.Ok>(second.await())
            assertIs<RefreshOutcome.Ok>(third.await())
        }
        assertEquals(1, calls)
        assertEquals("new-token", tokens.accessToken)
    }

    @Test
    fun rejectedSavedPasswordUsesCooldownAndKeepsExistingSession() = runBlocking {
        val tokens = InMemoryTokenStore("expired-token", "refresh-cookie")
        var now = 0L
        var calls = 0
        val refresher = TokenRefresher(tokens, {
            calls += 1
            RefreshOutcome.AccountRejected
        }, null, clock = { now })

        assertEquals(RefreshOutcome.AccountRejected, refresher.refresh())
        assertEquals(RefreshOutcome.AccountRejected, refresher.refresh())
        assertEquals(1, calls)
        assertEquals("expired-token", tokens.accessToken)

        now += 299_999L
        assertEquals(RefreshOutcome.AccountRejected, refresher.refresh())
        assertEquals(1, calls)
        now += 1L
        assertEquals(RefreshOutcome.AccountRejected, refresher.refresh())
        assertEquals(2, calls)
    }

    @Test
    fun transientRefreshFailuresAreRateLimited() = runBlocking {
        val tokens = InMemoryTokenStore("expired-token", "refresh-cookie")
        var now = 0L
        var calls = 0
        val refresher = TokenRefresher(tokens, {
            calls += 1
            RefreshOutcome.Transient
        }, null, clock = { now })

        assertEquals(RefreshOutcome.Transient, refresher.refresh())
        now += 29_999L
        assertEquals(RefreshOutcome.Transient, refresher.refresh())
        assertEquals(1, calls)
        now += 1L
        assertEquals(RefreshOutcome.Transient, refresher.refresh())
        assertEquals(2, calls)
    }

    @Test
    fun manualLoginDuringRefreshWinsOverLateRefreshResponse() = runBlocking {
        val tokens = InMemoryTokenStore("expired-token", "refresh-cookie")
        val started = CompletableDeferred<Unit>()
        val finish = CompletableDeferred<RefreshOutcome>()
        val refresher = TokenRefresher(tokens, {
            started.complete(Unit)
            finish.await()
        }, null)

        coroutineScope {
            val pending = async { refresher.refresh("expired-token") }
            started.await()
            refresher.installSession("manual-login-token", "manual-login-cookie")
            finish.complete(RefreshOutcome.Ok("late-refresh-token", "late-refresh-cookie"))

            val outcome = assertIs<RefreshOutcome.Ok>(pending.await())
            assertEquals("manual-login-token", outcome.accessToken)
            assertEquals("manual-login-token", tokens.accessToken)
            assertEquals("manual-login-cookie", tokens.refreshToken)
        }
    }
}
