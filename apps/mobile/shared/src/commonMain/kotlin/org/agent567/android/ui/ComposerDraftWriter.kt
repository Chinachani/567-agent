package org.agent567.android.ui

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.agent567.android.domain.session.SessionDraft

/** Main-scope coordinator. Each identity has one writer and at most one superseding snapshot. */
internal class ComposerDraftWriter(
    private val scope: CoroutineScope,
    private val write: suspend (String, String, SessionDraft) -> Unit,
    private val report: (String, String, SessionDraft, Boolean) -> Unit,
) {
    private data class Key(val session: String, val owner: String)
    private class Slot {
        var pending: SessionDraft? = null
        var urgent = false
        var wake: CompletableDeferred<Unit>? = null
        var worker: Job? = null
    }
    private val slots = mutableMapOf<Key, Slot>()

    fun submit(session: String, owner: String, draft: SessionDraft, immediate: Boolean) {
        val key = Key(session, owner)
        val slot = slots.getOrPut(key) { Slot() }
        slot.pending = draft
        if (immediate) { slot.urgent = true; slot.wake?.complete(Unit) }
        start(key, slot)
    }

    fun flush(): List<Job> = slots.toList().map { (key, slot) ->
        slot.urgent = true
        slot.wake?.complete(Unit)
        start(key, slot)
    }

    /** After flush/join at logout, drop unsaved account-scoped bytes and report the loss to the caller. */
    fun discardAfterLogout(): Boolean {
        val unsaved = slots.values.any { it.pending != null }
        slots.values.forEach { it.worker?.cancel() }
        slots.clear()
        return unsaved
    }

    fun forget(session: String) {
        slots.keys.filter { it.session == session }.forEach { key -> slots.remove(key)?.worker?.cancel() }
    }

    private fun start(key: Key, slot: Slot): Job {
        slot.worker?.let { return it }
        val job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                while (slot.pending != null) {
                    // A fixed window from the first edit: continuous typing cannot defer saving indefinitely.
                    if (!slot.urgent) {
                        val wake = CompletableDeferred<Unit>(); slot.wake = wake
                        withTimeoutOrNull(200L) { wake.await() }
                        slot.wake = null
                    }
                    slot.urgent = false
                    val snapshot = slot.pending ?: break
                    slot.pending = null
                    try {
                        write(key.session, key.owner, snapshot)
                        report(key.session, key.owner, snapshot, true)
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (_: Exception) {
                        if (slot.pending == null) {
                            slot.pending = snapshot
                            report(key.session, key.owner, snapshot, false)
                            break // Retry on the next edit or explicit flush, never in a busy loop.
                        }
                    }
                }
            } finally {
                slot.worker = null; slot.wake = null
                if (slot.pending == null && slots[key] === slot) slots.remove(key)
            }
        }
        slot.worker = job
        job.start()
        return job
    }
}
