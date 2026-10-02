package org.agent567.android.core.net

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.time.TimeSource
import org.agent567.android.core.auth.StoredTokens
import org.agent567.android.core.auth.TokenStore

private val refreshClockOrigin = TimeSource.Monotonic.markNow()

internal class TokenRefresher(
    private val tokenStore: TokenStore,
    private val refreshAction: suspend (String) -> RefreshOutcome,
    private val onUnauthorized: UnauthorizedHandler?,
    private val clock: () -> Long = { refreshClockOrigin.elapsedNow().inWholeMilliseconds },
    private val onRenewed: (RefreshOutcome.Ok) -> Unit = {},
) {
    private class Attempt(val tokens: StoredTokens, val epoch: Long) {
        val result = CompletableDeferred<RefreshOutcome>()
    }
    private data class Failure(val tokens: StoredTokens, val outcome: RefreshOutcome, val count: Int, val retryAt: Long)
    private val mutex = Mutex()
    private var epoch = 0L
    private var inFlight: Attempt? = null
    private var failure: Failure? = null

    suspend fun installSession(access: String, refresh: String) = mutex.withLock {
        epoch += 1
        failure = null
        tokenStore.save(access, refresh)
    }

    suspend fun clearSession() = mutex.withLock {
        epoch += 1
        failure = null
        tokenStore.clear()
    }

    suspend fun refresh(expectedAccessToken: String? = null): RefreshOutcome {
        val (attempt, owner) = mutex.withLock {
            val tokens = tokenStore.tokens.value ?: return RefreshOutcome.Unauthorized
            // A concurrent request or manual login already replaced the rejected token.
            if (expectedAccessToken != null && tokens.accessToken != expectedAccessToken) {
                return RefreshOutcome.Ok(tokens.accessToken, tokens.refreshToken)
            }
            failure?.takeIf { it.tokens == tokens && clock() < it.retryAt }?.let { return it.outcome }
            val active = inFlight
            if (active != null && active.epoch == epoch && active.tokens == tokens) {
                active to false
            } else {
                Attempt(tokens, epoch).also { inFlight = it } to true
            }
        }
        if (!owner) return attempt.result.await()
        try {
            val outcome = try {
                refreshAction(attempt.tokens.refreshToken)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                RefreshOutcome.Transient
            }
            return mutex.withLock {
                val result = if (attempt.epoch != epoch || tokenStore.tokens.value != attempt.tokens) {
                    tokenStore.tokens.value?.let { RefreshOutcome.Ok(it.accessToken, it.refreshToken) }
                        ?: RefreshOutcome.Unauthorized
                } else {
                    applyOutcome(attempt.tokens, outcome)
                    outcome
                }
                if (inFlight === attempt) inFlight = null
                attempt.result.complete(result)
                result
            }
        } catch (error: CancellationException) {
            withContext(NonCancellable) {
                mutex.withLock {
                    if (inFlight === attempt) inFlight = null
                    attempt.result.cancel(error)
                }
            }
            throw error
        } catch (_: Exception) {
            withContext(NonCancellable) {
                mutex.withLock {
                    if (inFlight === attempt) {
                        inFlight = null
                        if (tokenStore.tokens.value == attempt.tokens) {
                            val previous = failure?.takeIf { it.tokens == attempt.tokens && it.outcome == RefreshOutcome.Transient }
                            val count = (previous?.count ?: 0) + 1
                            val delay = (30_000L * (1L shl (count - 1).coerceAtMost(4))).coerceAtMost(300_000L)
                            failure = Failure(attempt.tokens, RefreshOutcome.Transient, count, clock() + delay)
                        }
                    }
                    attempt.result.complete(RefreshOutcome.Transient)
                }
            }
            return RefreshOutcome.Transient
        }
    }

    private fun applyOutcome(tokens: StoredTokens, outcome: RefreshOutcome) {
        when (outcome) {
            is RefreshOutcome.Ok -> {
                tokenStore.save(outcome.accessToken, outcome.refreshToken)
                failure = null
                runCatching { onRenewed(outcome) }
            }
            RefreshOutcome.Unauthorized -> {
                tokenStore.clear()
                failure = null
                runCatching { onUnauthorized?.onUnauthorized() }
            }
            RefreshOutcome.Transient, RefreshOutcome.AccountRejected -> {
                val previous = failure?.takeIf { it.tokens == tokens && it.outcome == outcome }
                val count = (previous?.count ?: 0) + 1
                val base = if (outcome == RefreshOutcome.AccountRejected) 300_000L else 30_000L
                val maximum = if (outcome == RefreshOutcome.AccountRejected) 1_800_000L else 300_000L
                val delay = (base * (1L shl (count - 1).coerceAtMost(6))).coerceAtMost(maximum)
                failure = Failure(tokens, outcome, count, clock() + delay)
            }
        }
    }
}
