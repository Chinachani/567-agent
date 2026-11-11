package org.agent567.android.ui.updates

import com.sun.net.httpserver.HttpServer
import java.io.File
import okhttp3.OkHttpClient
import java.net.InetSocketAddress
import java.net.URL
import java.nio.file.Files
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.Executors
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ResumableApkDownloaderHostTest {
    private val bytes = ByteArray(3 * 1024 * 1024) { (it % 251).toByte() }
    private val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private class Fixture(val mode: String, val bytes: ByteArray) : AutoCloseable {
        val directory: File = Files.createTempDirectory("agent567-apk-download").toFile()
        val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())
        val executor = Executors.newCachedThreadPool()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
            this.executor = this@Fixture.executor
            createContext("/") { request ->
                val range = request.requestHeaders.getFirst("Range").orEmpty()
                requests.add(range)
                val match = Regex("bytes=(\\d+)-(\\d*)").matchEntire(range)
                try {
                    if (mode == "single" || match == null || (mode == "fallback" && range != "bytes=0-0")) {
                        request.sendResponseHeaders(200, bytes.size.toLong())
                        request.responseBody.use { it.write(bytes) }
                    } else {
                        val start = match.groupValues[1].toInt()
                        val end = match.groupValues[2].toIntOrNull() ?: (bytes.size - 1)
                        val body = if (mode == "corrupt") ByteArray(end - start + 1) { 7 } else bytes.copyOfRange(start, end + 1)
                        request.responseHeaders.add("Content-Range", "bytes ${if (mode == "bad-range" && start > 0) start - 1 else start}-$end/${bytes.size}")
                        request.sendResponseHeaders(206, body.size.toLong())
                        request.responseBody.use { it.write(body) }
                    }
                } catch (_: Exception) { request.close() }
            }
            start()
        }
        // Replace only the TLS/socket boundary. Production URL validation and HTTP range logic execute unchanged.
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            chain.proceed(chain.request().newBuilder().url("http://127.0.0.1:${server.address.port}${chain.request().url.encodedPath}").build())
        }.followRedirects(false).build()
        fun downloader() = ResumableApkDownloader(directory, client = client)
        override fun close() { server.stop(0); executor.shutdownNow(); client.dispatcher.executorService.shutdown(); client.connectionPool.evictAll(); directory.deleteRecursively() }
    }

    private fun spec() = ApkDownloadSpec("https://fixture.example/update.apk", "v9.0.0", "567-agent-9.0.0.apk", bytes.size.toLong(), digest)

    @Test fun userDownloadsFourSegmentsAndGetsOneVerifiedPackage() = runBlocking {
        Fixture("ranges", bytes).use { fixture ->
            val output = fixture.downloader().download(spec()) {}
            assertContentEquals(bytes, output.readBytes())
            assertEquals(5, fixture.requests.size)
            assertEquals(1, fixture.directory.listFiles()!!.size)
            val requests = fixture.requests.size
            fixture.downloader().download(spec()) {}
            assertEquals(requests, fixture.requests.size)
        }
    }

    @Test fun userPausesThenResumesAfterReopeningWithoutRedownloadingSavedBytes() = runBlocking {
        Fixture("ranges", bytes).use { fixture ->
            val downloader = fixture.downloader()
            assertFailsWith<kotlinx.coroutines.CancellationException> {
                downloader.download(spec()) { if (it.downloadedBytes > 100_000) downloader.cancel() }
            }
            assertFalse(File(fixture.directory, spec().fileName).exists())
            val requestCount = fixture.requests.size
            val output = fixture.downloader().download(spec()) {}
            assertContentEquals(bytes, output.readBytes())
            assertTrue(fixture.requests.drop(requestCount + 1).any {
                it !in listOf("bytes=0-786431", "bytes=786432-1572863", "bytes=1572864-2359295", "bytes=2359296-3145727")
            })
        }
    }

    @Test fun previousTwoPieceDownloadsKeepTheirOriginalOffsetsWhenUpgrading() = runBlocking {
        for (parts in listOf(setOf(0, 1), setOf(1))) Fixture("ranges", bytes).use { fixture ->
            val spec = spec()
            val key = MessageDigest.getInstance("SHA-256").digest("${spec.version}\n${spec.url}\n${spec.sha256}".toByteArray())
                .joinToString("") { "%02x".format(it) }
            val work = File(fixture.directory, key).apply { mkdirs() }
            if (0 in parts) File(work, "range-0.part").writeBytes(bytes.copyOfRange(0, 200_000))
            File(work, "range-1.part").writeBytes(bytes.copyOfRange(bytes.size / 2, bytes.size / 2 + 100_000))
            val file = fixture.downloader().download(spec) {}
            assertContentEquals(bytes, file.readBytes())
            assertTrue(fixture.requests.contains("bytes=${if (0 in parts) 200_000 else 0}-1572863"))
            assertTrue(fixture.requests.contains("bytes=1672864-3145727"))
            assertEquals(3, fixture.requests.size)
        }
    }

    @Test fun sourceIgnoringRangesFallsBackToOneCompleteVerifiedDownload() = runBlocking {
        for (mode in listOf("single", "fallback")) Fixture(mode, bytes).use { fixture ->
            val output = fixture.downloader().download(spec()) {}
            assertContentEquals(bytes, output.readBytes())
            assertTrue(fixture.requests.contains(""))
        }
    }

    @Test fun invalidRangesAndCorruptContentNeverBecomeInstallablePackages() = runBlocking {
        for (mode in listOf("bad-range", "corrupt")) Fixture(mode, bytes).use { fixture ->
            assertFailsWith<Exception> { fixture.downloader().download(spec()) {} }
            assertFalse(File(fixture.directory, spec().fileName).exists())
        }
    }

    @Test fun unsafeUrlsAndMissingChecksumsAreRejectedBeforeAnyRequest() = runBlocking {
        Fixture("ranges", bytes).use { fixture ->
            for (invalid in listOf(spec().copy(url = "http://fixture.example/update.apk"), spec().copy(sha256 = ""), spec().copy(fileName = "../escape.apk"))) {
                assertFailsWith<Exception> { fixture.downloader().download(invalid) {} }
            }
            assertEquals(0, fixture.requests.size)
        }
    }
}
