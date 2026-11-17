package org.agent567.android.data.session

import com.russhwolf.settings.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import org.agent567.android.domain.followup.TaskResult

/** Durable, bounded snapshots. No prompts, attachments or provider errors are duplicated here. */
class ResultInboxStore(private val settings: Settings? = null) {
    private val mutex = Mutex()
    private val json = Json { ignoreUnknownKeys = true }
    private val mutable = MutableStateFlow<List<TaskResult>>(emptyList())
    val results = mutable.asStateFlow()
    private var loaded = false

    suspend fun load() = withContext(Dispatchers.IO) { mutex.withLock { read() } }
    private fun read() {
        if (loaded) return
        val stored = settings?.getStringOrNull(KEY)?.let { json.decodeFromString(Inbox.serializer(), it) } ?: Inbox()
        require(stored.schemaVersion == 1 && stored.tasks.size <= 500)
        mutable.value = stored.tasks
        loaded = true
    }

    suspend fun replaceSource(deviceId: String?, tasks: List<TaskResult>) = withContext(Dispatchers.IO) {
        mutex.withLock {
            read() // A corrupt ledger must not be silently replaced by an empty one.
            val previous = mutable.value.associateBy { it.key }
            val next = tasks.map { task ->
                val scoped = task.copy(deviceId = deviceId)
                scoped.copy(read = previous[scoped.key]?.let { it.read && it.revision == scoped.revision } == true)
            }
            save((mutable.value.filter { it.deviceId != deviceId } + next).distinctBy { it.key }
                .sortedByDescending { it.endedAt ?: it.startedAt }.take(500))
        }
    }
    suspend fun markRead(key: String) = withContext(Dispatchers.IO) {
        mutex.withLock { read(); save(mutable.value.map { if (it.key == key) it.copy(read = true) else it }) }
    }
    suspend fun clear() = withContext(Dispatchers.IO) {
        mutex.withLock { settings?.remove(KEY); mutable.value = emptyList(); loaded = true }
    }
    suspend fun removeSession(deviceId: String?, sessionId: String) = withContext(Dispatchers.IO) {
        mutex.withLock { read(); save(mutable.value.filterNot { it.deviceId == deviceId && it.sessionId == sessionId }) }
    }
    suspend fun removeDevice(deviceId: String) = withContext(Dispatchers.IO) {
        mutex.withLock { read(); save(mutable.value.filterNot { it.deviceId == deviceId }) }
    }
    private fun save(tasks: List<TaskResult>) {
        settings?.putString(KEY, json.encodeToString(Inbox.serializer(), Inbox(tasks = tasks)))
        mutable.value = tasks
    }
    @Serializable private data class Inbox(val schemaVersion: Int = 1, val tasks: List<TaskResult> = emptyList())
    private companion object { const val KEY = "agent567.result-inbox.v1" }
}
