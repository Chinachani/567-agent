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

    suspend fun load() = withStorage { read() }
    private fun read() {
        if (loaded) return
        val stored = settings?.getStringOrNull(KEY)?.let { json.decodeFromString(Inbox.serializer(), it) } ?: Inbox()
        require(stored.schemaVersion == 1 && stored.tasks.size <= 500)
        mutable.value = stored.tasks
        loaded = true
    }

    suspend fun replaceSource(deviceId: String?, tasks: List<TaskResult>) = withStorage {
        read() // A corrupt ledger must not be silently replaced by an empty one.
        val previous = mutable.value.associateBy { it.key }
        val next = tasks.map { task ->
            val scoped = task.copy(deviceId = deviceId)
            scoped.copy(read = previous[scoped.key]?.let { it.read && it.revision == scoped.revision } == true)
        }
        save((mutable.value.filter { it.deviceId != deviceId } + next).distinctBy { it.key }
            .sortedByDescending { it.endedAt ?: it.startedAt }.take(500))
    }
    suspend fun markRead(key: String) = withStorage {
        read(); save(mutable.value.map { if (it.key == key) it.copy(read = true) else it })
    }
    suspend fun clear() = withStorage {
        settings?.remove(KEY); mutable.value = emptyList(); loaded = true
    }
    suspend fun removeSession(deviceId: String?, sessionId: String) = withStorage {
        read(); save(mutable.value.filterNot { it.deviceId == deviceId && it.sessionId == sessionId })
    }
    suspend fun removeDevice(deviceId: String) = withStorage {
        read(); save(mutable.value.filterNot { it.deviceId == deviceId })
    }
    private suspend fun <T> withStorage(block: () -> T): T {
        // Only the persistent store performs IO. Memory-only containers stay on
        // their owning dispatcher, including previews and isolated host fixtures.
        if (settings == null) return mutex.withLock { block() }
        return withContext(Dispatchers.IO) { mutex.withLock { block() } }
    }
    private fun save(tasks: List<TaskResult>) {
        settings?.putString(KEY, json.encodeToString(Inbox.serializer(), Inbox(tasks = tasks)))
        mutable.value = tasks
    }
    @Serializable private data class Inbox(val schemaVersion: Int = 1, val tasks: List<TaskResult> = emptyList())
    private companion object { const val KEY = "agent567.result-inbox.v1" }
}
