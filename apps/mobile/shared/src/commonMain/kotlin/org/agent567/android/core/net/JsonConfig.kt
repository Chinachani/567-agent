package org.agent567.android.core.net

import kotlinx.serialization.json.Json

internal val Agent567Json: Json =
    Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = false
        explicitNulls = false
        coerceInputValues = true
    }
