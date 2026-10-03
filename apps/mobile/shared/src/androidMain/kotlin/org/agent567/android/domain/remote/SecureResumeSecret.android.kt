package org.agent567.android.domain.remote

import java.security.SecureRandom
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

@OptIn(ExperimentalEncodingApi::class)
actual fun createSecureRemoteResumeSecret(): String {
    val bytes = ByteArray(32).also(SecureRandom()::nextBytes)
    return Base64.UrlSafe.encode(bytes).trimEnd('=')
}
