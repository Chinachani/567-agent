package org.agent567.android.domain.followup

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive
import kotlinx.coroutines.cancelAndJoin
import org.agent567.android.data.session.ResultInboxStore
import org.agent567.android.domain.conversation.RemoteConversationGateway
import org.agent567.android.domain.device.DeviceStatus
import org.agent567.android.domain.session.SessionStore
import org.agent567.android.ui.i18n.Str

class ResultInboxCoordinator(
    private val scope: CoroutineScope,
    private val store: ResultInboxStore,
    private val sessions: SessionStore,
    private val gateway: RemoteConversationGateway,
    private val running: () -> Set<String>,
    private val canRefresh: () -> Boolean = { true },
) {
    val results = store.results
    private val mutableNotice = MutableStateFlow<String?>(null)
    val notice = mutableNotice.asStateFlow()
    private val mutableLoading = MutableStateFlow(false)
    val loading = mutableLoading.asStateFlow()
    private var job: Job? = null
    private var refreshAgain = false

    fun refresh() {
        if (!canRefresh()) return
        if (job?.isActive == true) { refreshAgain = true; return }
        // Directory and ledger reads are bounded IO work. Keeping this child on IO also
        // prevents a platform Main dispatcher from being touched after a host test or
        // a ViewModel has already been torn down.
        job = scope.launch(Dispatchers.IO) {
            mutableLoading.value = true
            val notices = mutableSetOf<String>()
            try {
                store.load()
                store.replaceSource(null, readLocalTaskResults(sessions, running()))
                for (device in gateway.devices.value.filter { it.status == DeviceStatus.Online }) {
                    try {
                        val snapshot = gateway.readTaskResults(device.id)
                        if (snapshot == null) { notices += Str.resultInboxUnsupported; continue }
                        // Preserve previous offline entries on a partial directory read.
                        val tasks = if (snapshot.unavailableCount > 0) {
                            val keys = snapshot.tasks.mapTo(mutableSetOf()) { it.key }
                            store.results.value.filter { it.deviceId == device.id && it.key !in keys } + snapshot.tasks
                        } else snapshot.tasks
                        store.replaceSource(device.id, tasks)
                        if (snapshot.unavailableCount > 0) notices += Str.resultInboxPartial
                        if (snapshot.truncated) notices += Str.resultInboxLimited
                    } catch (error: CancellationException) { throw error }
                    catch (_: Exception) { notices += Str.resultInboxPartial }
                }
                mutableNotice.value = notices.joinToString("\n").ifBlank { null }
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) { mutableNotice.value = Str.resultInboxFailed }
            finally {
                mutableLoading.value = false
                job = null
                if (refreshAgain) { refreshAgain = false; if (scope.isActive) refresh() }
            }
        }
    }
    private suspend fun stopRefresh() {
        refreshAgain = false
        job?.cancelAndJoin()
    }
    suspend fun clear() { stopRefresh(); store.clear(); mutableNotice.value = null }
    suspend fun removeSession(deviceId: String?, sessionId: String) { stopRefresh(); store.removeSession(deviceId, sessionId) }
    suspend fun removeDevice(deviceId: String) { stopRefresh(); store.removeDevice(deviceId) }
    fun markRead(key: String) {
        scope.launch(Dispatchers.IO) {
            try { store.markRead(key) }
            catch (error: CancellationException) { throw error }
            catch (_: Exception) { mutableNotice.value = Str.resultInboxFailed }
        }
    }
}
