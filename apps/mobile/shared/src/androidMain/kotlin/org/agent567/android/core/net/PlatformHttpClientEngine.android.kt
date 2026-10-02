package org.agent567.android.core.net

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngineFactory
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.websocket.WebSockets
import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

actual fun platformHttpClientEngine(): HttpClientEngineFactory<*> = OkHttp

actual fun pinnedWebSocketHttpClient(certificateFingerprint: String): HttpClient {
    val expected = certificateFingerprint.lowercase()
    require(expected.matches(Regex("[a-f0-9]{64}"))) { "Invalid pinned certificate fingerprint" }
    val trustManager = object : X509TrustManager {
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) {
            throw CertificateException("Client certificates are not accepted")
        }
        override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) {
            val certificate = chain.firstOrNull() ?: throw CertificateException("Server certificate is missing")
            certificate.checkValidity()
            if (certificate.sha256Fingerprint() != expected) throw CertificateException("Server certificate pin mismatch")
        }
    }
    val sslContext = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trustManager), null) }
    return HttpClient(OkHttp) {
        install(WebSockets)
        engine {
            config {
                sslSocketFactory(sslContext.socketFactory, trustManager)
                hostnameVerifier(HostnameVerifier { _, session ->
                    val certificate = session.peerCertificates.firstOrNull() as? X509Certificate
                    certificate?.sha256Fingerprint() == expected
                })
            }
        }
    }
}

private fun X509Certificate.sha256Fingerprint(): String =
    MessageDigest.getInstance("SHA-256").digest(encoded).joinToString("") { "%02x".format(it) }
