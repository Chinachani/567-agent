package org.agent567.android.core.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

object AndroidNetworkAvailability {
    private val state = MutableStateFlow(NetworkAvailability.Unknown)
    private var callback: ConnectivityManager.NetworkCallback? = null
    private var defaultNetwork: Network? = null

    @Synchronized
    fun initialize(context: Context) {
        if (callback != null) return
        val manager = context.applicationContext.getSystemService(ConnectivityManager::class.java) ?: return
        val observer = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                synchronized(AndroidNetworkAvailability) {
                    defaultNetwork = network
                    state.value = NetworkAvailability.Available
                }
            }

            override fun onLost(network: Network) {
                synchronized(AndroidNetworkAvailability) {
                    // A replaced network can report onLost after its replacement
                    // reports onAvailable. Do not mark the new network offline.
                    if (defaultNetwork == network) {
                        defaultNetwork = null
                        state.value = NetworkAvailability.Unavailable
                    }
                }
            }
        }
        try {
            manager.registerDefaultNetworkCallback(observer)
            callback = observer
            defaultNetwork = manager.activeNetwork
            state.value = if (defaultNetwork == null) NetworkAvailability.Unavailable else NetworkAvailability.Available
        } catch (_: SecurityException) {
            state.value = NetworkAvailability.Unknown
        }
    }

    fun observe(): StateFlow<NetworkAvailability> = state.asStateFlow()
}

actual fun platformNetworkAvailability(): StateFlow<NetworkAvailability> = AndroidNetworkAvailability.observe()
