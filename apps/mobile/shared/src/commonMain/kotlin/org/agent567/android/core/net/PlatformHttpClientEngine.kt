package org.agent567.android.core.net

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngineFactory

expect fun platformHttpClientEngine(): HttpClientEngineFactory<*>

expect fun platformWebSocketHttpClient(): HttpClient

expect fun pinnedWebSocketHttpClient(certificateFingerprint: String): HttpClient
