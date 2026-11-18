package org.agent567.android.ui

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Used on the collecting dispatcher. Keep one worker even when publishing suspends. */
internal class ConflatedStreamPublisher(
    private val scope: CoroutineScope,
    private val intervalMs: Long,
    private val publishLatest: suspend () -> Unit,
) {
    private var dirty = false
    private var worker: Job? = null

    fun request() {
        dirty = true
        if (worker != null) return
        val job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                while (dirty) {
                    delay(intervalMs)
                    dirty = false
                    publishLatest()
                }
            } finally {
                worker = null
            }
        }
        worker = job
        job.start()
    }

    suspend fun stop() {
        dirty = false
        worker?.cancelAndJoin()
    }
}
