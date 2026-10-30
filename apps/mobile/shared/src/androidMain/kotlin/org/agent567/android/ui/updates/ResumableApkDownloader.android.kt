package org.agent567.android.ui.updates

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Collections
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal data class ApkDownloadSpec(
    val url: String,
    val version: String,
    val fileName: String,
    val expectedBytes: Long,
    val sha256: String,
)

internal data class ApkDownloadProgress(val downloadedBytes: Long, val totalBytes: Long)

/** Two bounded HTTP ranges, with per-range files so an interrupted run can resume safely. */
internal class ResumableApkDownloader(
    private val downloadDirectory: File,
    private val parallelism: Int = 2,
    private val connect: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection },
) {
    private val connections = Collections.synchronizedSet(mutableSetOf<HttpURLConnection>())
    @Volatile private var cancelled = false

    suspend fun download(spec: ApkDownloadSpec, onProgress: (ApkDownloadProgress) -> Unit): File =
        downloadLock.withLock { withContext(Dispatchers.IO) {
            validate(spec)
            cancelled = false
            downloadDirectory.mkdirs()
            val workDirectory = File(downloadDirectory, workKey(spec))
            workDirectory.mkdirs()
            val output = File(downloadDirectory, spec.fileName)
            if (output.isFile && output.length() == spec.expectedBytes && matchesDigest(output, spec.sha256)) {
                currentCoroutineContext().ensureActive()
                checkNotCancelled()
                onProgress(ApkDownloadProgress(output.length(), spec.expectedBytes))
                return@withContext output
            }

            val downloaded = AtomicLong(partFiles(workDirectory).sumOf { it.length() })
            onProgress(ApkDownloadProgress(downloaded.get(), spec.expectedBytes))
            try {
                val supportsRanges = probe(spec)
                if (supportsRanges && spec.expectedBytes >= MIN_PARALLEL_BYTES && parallelism > 1) {
                    File(workDirectory, "single.part").delete()
                    downloaded.set(partFiles(workDirectory).sumOf { it.length() })
                    try {
                        downloadRanges(spec, workDirectory, downloaded, onProgress)
                    } catch (_: RangeUnsupportedException) {
                        partFiles(workDirectory).forEach(File::delete)
                        downloaded.set(0)
                        onProgress(ApkDownloadProgress(0, spec.expectedBytes))
                        downloadSingle(spec, workDirectory, downloaded, onProgress)
                    }
                } else {
                    partFiles(workDirectory).filter { it.name.startsWith("range-") }.forEach(File::delete)
                    downloaded.set(File(workDirectory, "single.part").length())
                    downloadSingle(spec, workDirectory, downloaded, onProgress)
                }
                currentCoroutineContext().ensureActive()
                val staging = File(workDirectory, "assembled.apk")
                staging.delete()
                assemble(workDirectory, staging)
                if (staging.length() != spec.expectedBytes || !matchesDigest(staging, spec.sha256)) {
                    staging.delete()
                    workDirectory.deleteRecursively()
                    throw IOException("The downloaded package did not pass integrity verification")
                }
                currentCoroutineContext().ensureActive()
                checkNotCancelled()
                if (output.exists() && !output.delete()) throw IOException("Unable to replace the previous update package")
                if (!staging.renameTo(output)) throw IOException("Unable to finalize the downloaded update package")
                workDirectory.deleteRecursively()
                onProgress(ApkDownloadProgress(spec.expectedBytes, spec.expectedBytes))
                output
            } catch (error: CancellationException) {
                throw error
            } finally {
                disconnectAll()
            }
        } }

    fun verifyFile(spec: ApkDownloadSpec, file: File) {
        validate(spec)
        require(file.isFile && file.length() == spec.expectedBytes && matchesDigest(file, spec.sha256)) {
            "The downloaded package did not pass integrity verification"
        }
    }

    fun cancel() {
        cancelled = true
        disconnectAll()
    }

    private suspend fun downloadRanges(
        spec: ApkDownloadSpec,
        workDirectory: File,
        downloaded: AtomicLong,
        onProgress: (ApkDownloadProgress) -> Unit,
    ) = coroutineScope {
        val workerCount = minOf(parallelism, 2)
        val ranges = (0 until workerCount).map { index ->
            val start = spec.expectedBytes * index / workerCount
            val endExclusive = spec.expectedBytes * (index + 1) / workerCount
            Triple(index, start, endExclusive)
        }
        ranges.map { (index, start, endExclusive) ->
            async(Dispatchers.IO) {
                downloadRangePart(spec, File(workDirectory, "range-$index.part"), start, endExclusive, downloaded, onProgress)
            }
        }.awaitAll()
    }

    private suspend fun downloadRangePart(
        spec: ApkDownloadSpec,
        part: File,
        rangeStart: Long,
        rangeEndExclusive: Long,
        downloaded: AtomicLong,
        onProgress: (ApkDownloadProgress) -> Unit,
    ) {
        val length = rangeEndExclusive - rangeStart
        if (part.length() > length) {
            downloaded.addAndGet(-part.length())
            part.delete()
        }
        var attempt = 0
        while (part.length() < length) {
            currentCoroutineContext().ensureActive()
            checkNotCancelled()
            attempt += 1
            try {
                val start = rangeStart + part.length()
                val connection = open(spec.url, start, rangeEndExclusive - 1)
                try {
                    if (connection.responseCode != HttpURLConnection.HTTP_PARTIAL) throw RangeUnsupportedException()
                    val contentRange = parseContentRange(connection.getHeaderField("Content-Range"))
                        ?: throw IOException("The update server returned an invalid byte range")
                    if (contentRange.start != start || contentRange.total != spec.expectedBytes || contentRange.end >= rangeEndExclusive) {
                        throw IOException("The update server returned a mismatched byte range")
                    }
                    BufferedInputStream(connection.inputStream).use { input ->
                        BufferedOutputStream(FileOutputStream(part, true)).use { output ->
                            val buffer = ByteArray(BUFFER_SIZE)
                            var written = 0L
                            val responseLength = contentRange.end - contentRange.start + 1
                            while (true) {
                                currentCoroutineContext().ensureActive()
                                checkNotCancelled()
                                val read = input.read(buffer)
                                if (read < 0) break
                                written += read
                                if (written > responseLength) throw IOException("The update server exceeded the requested byte range")
                                output.write(buffer, 0, read)
                                onProgress(ApkDownloadProgress(downloaded.addAndGet(read.toLong()), spec.expectedBytes))
                            }
                            if (written != responseLength) throw IOException("The update server ended a byte range early")
                        }
                    }
                } finally {
                    release(connection)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: RangeUnsupportedException) {
                throw error
            } catch (error: Exception) {
                if (attempt >= MAX_ATTEMPTS) throw error
                delay(RETRY_DELAYS_MS[attempt - 1])
            }
        }
    }

    private suspend fun downloadSingle(
        spec: ApkDownloadSpec,
        workDirectory: File,
        downloaded: AtomicLong,
        onProgress: (ApkDownloadProgress) -> Unit,
    ) {
        val part = File(workDirectory, "single.part")
        if (part.length() > spec.expectedBytes) part.delete()
        downloaded.set(part.length())
        var attempt = 0
        while (part.length() < spec.expectedBytes) {
            currentCoroutineContext().ensureActive()
            checkNotCancelled()
            attempt += 1
            try {
                val offset = part.length()
                val connection = open(spec.url, if (offset > 0) offset else null, null)
                try {
                    val status = connection.responseCode
                    if (status == HttpURLConnection.HTTP_PARTIAL) {
                        val contentRange = parseContentRange(connection.getHeaderField("Content-Range"))
                            ?: throw IOException("The update server returned an invalid byte range")
                        if (contentRange.start != offset || contentRange.total != spec.expectedBytes) {
                            throw IOException("The update server returned a mismatched byte range")
                        }
                    } else if (status == HttpURLConnection.HTTP_OK) {
                        if (offset > 0) {
                            part.delete()
                            downloaded.addAndGet(-offset)
                        }
                    } else {
                        throw IOException("The update server rejected the package download")
                    }
                    val append = status == HttpURLConnection.HTTP_PARTIAL && offset > 0
                    if (status == HttpURLConnection.HTTP_PARTIAL && offset == 0L) part.delete()
                    BufferedInputStream(connection.inputStream).use { input ->
                        BufferedOutputStream(FileOutputStream(part, append)).use { output ->
                            val buffer = ByteArray(BUFFER_SIZE)
                            var savedBytes = if (append) offset else 0L
                            while (true) {
                                currentCoroutineContext().ensureActive()
                                checkNotCancelled()
                                val read = input.read(buffer)
                                if (read < 0) break
                                savedBytes += read
                                if (savedBytes > spec.expectedBytes) throw IOException("The update server sent an oversized package")
                                output.write(buffer, 0, read)
                                onProgress(ApkDownloadProgress(downloaded.addAndGet(read.toLong()), spec.expectedBytes))
                            }
                            if (savedBytes != spec.expectedBytes) throw IOException("The update server ended the package early")
                        }
                    }
                } finally {
                    release(connection)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (attempt >= MAX_ATTEMPTS) throw error
                delay(RETRY_DELAYS_MS[attempt - 1])
            }
        }
    }

    private fun probe(spec: ApkDownloadSpec): Boolean {
        val connection = open(spec.url, 0, 0)
        return try {
            connection.responseCode == HttpURLConnection.HTTP_PARTIAL &&
                parseContentRange(connection.getHeaderField("Content-Range"))?.let {
                    it.start == 0L && it.end == 0L && it.total == spec.expectedBytes
                } == true
        } finally {
            release(connection)
        }
    }

    private fun open(url: String, start: Long?, end: Long?): HttpURLConnection {
        var current = URL(url)
        for (redirectCount in 0..MAX_REDIRECTS) {
            requireSafeHttps(current)
            checkNotCancelled()
            val connection = connect(current).apply {
                instanceFollowRedirects = false
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                requestMethod = "GET"
                setRequestProperty("Accept-Encoding", "identity")
                if (start != null) setRequestProperty("Range", "bytes=$start-${end ?: ""}")
            }
            connections.add(connection)
            val status = try {
                connection.responseCode
            } catch (error: Exception) {
                release(connection)
                throw error
            }
            if (status in REDIRECT_CODES) {
                val location = connection.getHeaderField("Location")
                release(connection)
                if (redirectCount >= MAX_REDIRECTS || location.isNullOrBlank()) throw IOException("The update server redirected too many times")
                current = URL(current, location)
                continue
            }
            return connection
        }
        throw IOException("The update server redirected too many times")
    }

    private fun requireSafeHttps(url: URL) {
        if (url.protocol != "https" || url.userInfo != null || url.host.isBlank()) {
            throw IOException("The update source must use HTTPS")
        }
    }

    private fun release(connection: HttpURLConnection) {
        connections.remove(connection)
        connection.disconnect()
    }

    private fun disconnectAll() {
        synchronized(connections) { connections.toList() }.forEach(::release)
    }

    private fun checkNotCancelled() {
        if (cancelled) throw CancellationException("Update download paused")
    }

    private fun assemble(directory: File, output: File) {
        val ranges = partFiles(directory).filter { it.name.startsWith("range-") }.sortedBy { it.name }
        val parts = if (ranges.isNotEmpty()) ranges else listOf(File(directory, "single.part"))
        BufferedOutputStream(FileOutputStream(output)).use { destination ->
            for (part in parts) {
                if (!part.isFile) throw IOException("An update download segment is missing")
                BufferedInputStream(FileInputStream(part)).use { input -> input.copyTo(destination, BUFFER_SIZE) }
            }
        }
    }

    private fun partFiles(directory: File): List<File> =
        directory.listFiles()?.filter { it.isFile && it.name.endsWith(".part") }.orEmpty()

    private fun validate(spec: ApkDownloadSpec) {
        requireSafeHttps(URL(spec.url))
        require(spec.expectedBytes in 1..1024L * 1024 * 1024) { "The release did not include a valid package size" }
        require(spec.sha256.matches(Regex("[0-9a-fA-F]{64}"))) { "The release did not include a valid SHA-256 digest" }
        require(spec.fileName.matches(Regex("[A-Za-z0-9._-]{1,120}\\.apk", RegexOption.IGNORE_CASE))) { "Invalid APK file name" }
        require(spec.version.isNotBlank() && spec.version.length <= 64)
    }

    private fun workKey(spec: ApkDownloadSpec): String =
        sha256("${spec.version}\n${spec.url}\n${spec.sha256}")

    private fun matchesDigest(file: File, expected: String): Boolean {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { input ->
            val buffer = ByteArray(BUFFER_SIZE)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                digest.update(buffer, 0, count)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }.equals(expected, ignoreCase = true)
    }

    private fun sha256(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    private data class ContentRange(val start: Long, val end: Long, val total: Long)

    private fun parseContentRange(value: String?): ContentRange? {
        val match = CONTENT_RANGE.matchEntire(value.orEmpty()) ?: return null
        val result = ContentRange(match.groupValues[1].toLongOrNull() ?: return null,
            match.groupValues[2].toLongOrNull() ?: return null,
            match.groupValues[3].toLongOrNull() ?: return null)
        return result.takeIf { it.start >= 0 && it.end >= it.start && it.total > it.end }
    }

    private class RangeUnsupportedException : IOException()

    private companion object {
        val downloadLock = Mutex()
        const val BUFFER_SIZE = 64 * 1024
        const val MIN_PARALLEL_BYTES = 2L * 1024 * 1024
        const val CONNECT_TIMEOUT_MS = 20_000
        const val READ_TIMEOUT_MS = 30_000
        const val MAX_REDIRECTS = 8
        const val MAX_ATTEMPTS = 3
        val RETRY_DELAYS_MS = longArrayOf(500, 1500)
        val REDIRECT_CODES = setOf(301, 302, 303, 307, 308)
        val CONTENT_RANGE = Regex("bytes (\\d+)-(\\d+)/(\\d+)", RegexOption.IGNORE_CASE)
    }
}
