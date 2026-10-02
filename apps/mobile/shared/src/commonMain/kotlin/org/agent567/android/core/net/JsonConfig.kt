package org.agent567.android.core.net

import kotlinx.serialization.json.Json

internal val VettaJson: Json =
    Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = false
        explicitNulls = false
        coerceInputValues = true
    }
