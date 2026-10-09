package org.agent567.android.ui.media

import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.graphics.Matrix
import android.Manifest
import android.content.Context
import android.content.ContentValues
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.LruCache
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.exifinterface.media.ExifInterface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import org.agent567.android.data.session.MessageImageFileSystem
import org.agent567.android.domain.session.MessageImage
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val decodedImageCache = object : LruCache<String, ImageBitmap>(16 * 1024 * 1024) {
    override fun sizeOf(key: String, value: ImageBitmap): Int =
        (value.width.toLong() * value.height.toLong() * 4L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
}

actual fun imageBitmapFromBytes(bytes: ByteArray): ImageBitmap? {
    val cacheKey = bytes.sha256Key()
    decodedImageCache.get(cacheKey)?.let { return it }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val options = scaledBitmapOptions(bounds.outWidth, bounds.outHeight)
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
    val exif = runCatching { ExifInterface(ByteArrayInputStream(bytes)) }.getOrNull()
    val bitmap = exif?.let { orientBitmap(decoded, it.rotationDegrees, it.isFlipped) } ?: decoded
    return bitmap.asImageBitmap().also { decodedImageCache.put(cacheKey, it) }
}

actual fun imageBitmapFromStorageKey(key: String): ImageBitmap? {
    val root = MessageImageFileSystem.directory() ?: return null
    if (!key.matches(Regex("[A-Za-z0-9_-]{1,96}"))) return null
    val file = File(root, "$key.img")
    if (!file.isFile || file.length() !in 1L..MAX_MESSAGE_IMAGE_BYTES.toLong()) return null
    val cacheKey = "${file.absolutePath}:${file.length()}:${file.lastModified()}"
    decodedImageCache.get(cacheKey)?.let { return it }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    val options = scaledBitmapOptions(bounds.outWidth, bounds.outHeight)
    val decoded = BitmapFactory.decodeFile(file.absolutePath, options) ?: return null
    val exif = runCatching { ExifInterface(file.absolutePath) }.getOrNull()
    val bitmap = exif?.let { orientBitmap(decoded, it.rotationDegrees, it.isFlipped) } ?: decoded
    return bitmap.asImageBitmap().also {
        decodedImageCache.put(cacheKey, it)
    }
}

@Composable
actual fun rememberImageCapture(
    onPicked: (PickedImage) -> Unit,
    onRejected: (Int) -> Unit,
): () -> Unit {
    val context = LocalContext.current
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        if (bitmap == null) return@rememberLauncherForActivityResult
        try {
            var compressed = false
            val bytes = ByteArrayOutputStream().use { output ->
                compressed = bitmap.compress(Bitmap.CompressFormat.JPEG, 92, output)
                output.toByteArray()
            }
            if (!compressed || bytes.isEmpty() || bytes.size > MAX_PICKED_IMAGE_BYTES) {
                onRejected(1)
            } else {
                onPicked(PickedImage("image/jpeg", "567-agent-camera-${System.currentTimeMillis()}.jpg", bytes))
            }
        } finally {
            bitmap.recycle()
        }
    }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launcher.launch(null)
    }
    return remember(context, launcher, permissionLauncher, onPicked, onRejected) {
        {
            if (context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                launcher.launch(null)
            } else {
                permissionLauncher.launch(Manifest.permission.CAMERA)
            }
        }
    }
}

private fun orientBitmap(bitmap: Bitmap, rotationDegrees: Int, flipped: Boolean): Bitmap {
    if (rotationDegrees == 0 && !flipped) return bitmap
    val matrix = Matrix().apply {
        postRotate(rotationDegrees.toFloat())
        if (flipped) postScale(-1f, 1f)
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        .also { if (it !== bitmap) bitmap.recycle() }
}

private fun ByteArray.sha256Key(): String =
    MessageDigest.getInstance("SHA-256").digest(this).joinToString("") { byte -> "%02x".format(byte) }

private fun scaledBitmapOptions(width: Int, height: Int): BitmapFactory.Options {
    var sample = 1
    while (width / sample > 1280 || height / sample > 1280) sample *= 2
    return BitmapFactory.Options().apply {
        inSampleSize = sample
        inPreferredConfig = android.graphics.Bitmap.Config.ARGB_8888
    }
}

@Composable
actual fun rememberImagePicker(
    onPicked: (List<PickedImage>) -> Unit,
    onRejected: (Int) -> Unit,
): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher =
        rememberLauncherForActivityResult(
            contract = ActivityResultContracts.GetMultipleContents(),
        ) { uris ->
            scope.launch {
            var rejectedCount = (uris.size - MAX_PICKED_IMAGE_COUNT).coerceAtLeast(0)
            val picked = withContext(Dispatchers.IO) {
                uris.take(MAX_PICKED_IMAGE_COUNT).mapNotNull { uri ->
                    runCatching {
                        val mime = normalizeSupportedImageMimeType(context.contentResolver.getType(uri))
                        if (mime == null) {
                            rejectedCount++
                            return@runCatching null
                        }
                            val bytes =
                                context.contentResolver.openInputStream(uri)?.use { it.readUpTo(MAX_PICKED_IMAGE_BYTES + 1) }
                                    ?: run {
                                        rejectedCount++
                                        return@runCatching null
                                    }
                            // 限制单图约 4MB，读取时也设上限，避免先把超大文件全部载入内存。
                        if (bytes.size > MAX_PICKED_IMAGE_BYTES) {
                            rejectedCount++
                            return@runCatching null
                        }
                        if (!imageSignatureMatches(bytes, mime) || !imageHasReadableDimensions(bytes)) {
                            rejectedCount++
                            return@runCatching null
                        }
                        val name = uri.lastPathSegment
                        PickedImage(mimeType = mime, fileName = name, bytes = bytes)
                        }.getOrElse {
                            rejectedCount++
                            null
                        }
                    }
                }
                if (picked.isNotEmpty()) {
                    onPicked(picked)
                }
                if (rejectedCount > 0) onRejected(rejectedCount)
            }
        }
    return remember(launcher, onPicked, onRejected) {
        { launcher.launch("image/*") }
    }
}

@Composable
actual fun rememberFileAttachmentPicker(
    onPicked: (List<PickedFileAttachment>) -> Unit,
    onRejected: () -> Unit,
): () -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            val files = withContext(Dispatchers.IO) {
                uris.take(MAX_MESSAGE_FILE_COUNT).mapNotNull { uri ->
                    runCatching {
                        val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                            ?.use { cursor ->
                                if (cursor.moveToFirst()) cursor.getString(0)?.takeIf(String::isNotBlank) else null
                            }
                            ?: uri.lastPathSegment?.substringAfterLast('/')?.substringAfterLast(':')?.takeIf(String::isNotBlank)
                            ?: "attachment"
                        val mime = context.contentResolver.getType(uri)
                            ?.substringBefore(';')
                            ?.trim()
                            ?.takeIf { it.matches(Regex("[A-Za-z0-9.+-]{1,127}/[A-Za-z0-9.+-]{1,127}")) }
                            ?: "application/octet-stream"
                        val bytes = context.contentResolver.openInputStream(uri)?.use {
                            it.readUpTo(MAX_MESSAGE_FILE_BYTES + 1)
                        } ?: return@runCatching null
                        if (bytes.isEmpty() || bytes.size > MAX_MESSAGE_FILE_BYTES) return@runCatching null
                        PickedFileAttachment(name, mime.lowercase(), bytes)
                    }.getOrNull()
                }
            }
            if (files.isNotEmpty()) onPicked(files)
            if (files.size != uris.size) onRejected()
        }
    }
    return remember(launcher) { { launcher.launch(arrayOf("*/*")) } }
}

private fun normalizeSupportedImageMimeType(rawMimeType: String?): String? =
    when (rawMimeType?.substringBefore(';')?.trim()?.lowercase()) {
        "image/jpeg", "image/jpg" -> "image/jpeg"
        "image/png" -> "image/png"
        "image/webp" -> "image/webp"
        else -> null
    }

private fun imageSignatureMatches(bytes: ByteArray, mimeType: String): Boolean =
    when (mimeType) {
        "image/jpeg" -> bytes.size >= 3 && bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte() && bytes[2] == 0xFF.toByte()
        "image/png" -> bytes.size >= 8 && bytes.copyOfRange(0, 8).contentEquals(
            byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A),
        )
        "image/webp" -> bytes.size >= 12 &&
            bytes.copyOfRange(0, 4).decodeToString() == "RIFF" &&
            bytes.copyOfRange(8, 12).decodeToString() == "WEBP"
        else -> false
    }

private fun imageHasReadableDimensions(bytes: ByteArray): Boolean {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    return bounds.outWidth > 0 && bounds.outHeight > 0
}

private const val MAX_MESSAGE_IMAGE_BYTES = 12 * 1024 * 1024

@Composable
actual fun rememberImageSaver(): (MessageImage, (Boolean, String) -> Unit) -> Unit {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    return remember(context, scope) {
        { image, onResult ->
            scope.launch {
                val result = withContext(Dispatchers.IO) {
                    saveMessageImageToGallery(context, image)
                }
                onResult(result.first, result.second)
            }
        }
    }
}

private fun saveMessageImageToGallery(context: Context, image: MessageImage): Pair<Boolean, String> {
    return try {
        val mimeType = image.mimeType.takeIf { it.startsWith("image/") } ?: "image/png"
        val suppliedName = image.fileName.orEmpty()
            .substringAfterLast('/')
            .substringAfterLast('\\')
            .filterNot { it.isISOControl() }
        val baseName = suppliedName.substringBeforeLast('.', suppliedName)
            .trim('.', ' ')
            .take(80)
            .ifBlank { "567_Agent_${System.currentTimeMillis()}" }
        // Derive the suffix from the payload MIME type; user supplied filenames
        // may have a stale extension (notably HEIC images renamed as JPEG).
        val filename = "$baseName.${mimeType.fileExtension()}"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/567Agent")
            }
            val uri = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            if (uri == null) {
                false to "无法创建相册图片"
            } else {
                val saved = openImageStream(image)?.use { input ->
                    context.contentResolver.openOutputStream(uri)?.use { output -> input.copyTo(output) }
                } != null
                if (!saved) context.contentResolver.delete(uri, null, null)
                if (saved) true to "图片已保存至系统相册" else false to "保存失败，请重试"
            }
        } else {
            val imagesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
            val appDir = File(imagesDir, "567Agent").apply { if (!exists()) mkdirs() }
            val file = File(appDir, filename)
            val saved = openImageStream(image)?.use { input -> file.outputStream().use { output -> input.copyTo(output) } } != null
            if (saved) {
                android.media.MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(mimeType), null)
                true to "图片已保存至系统相册"
            } else {
                file.delete()
                false to "保存失败，请重试"
            }
        }
    } catch (error: Exception) {
        false to "保存异常: ${error.message}"
    }
}

private fun openImageStream(image: MessageImage): InputStream? {
    return when {
        image.storageKey != null -> {
            val root = MessageImageFileSystem.directory() ?: return null
            if (!image.storageKey.matches(Regex("[A-Za-z0-9_-]{1,96}"))) return null
            File(root, "${image.storageKey}.img").takeIf(File::isFile)?.inputStream()
        }
        image.pendingBytes != null -> ByteArrayInputStream(image.pendingBytes)
        image.base64Data.isNotBlank() -> {
            if (image.base64Data.length > MAX_MESSAGE_IMAGE_BASE64_CHARS) return null
            val payload = image.base64Data.substringAfter(',', image.base64Data)
            ByteArrayInputStream(android.util.Base64.decode(payload, android.util.Base64.DEFAULT))
        }
        else -> null
    }
}

private fun InputStream.readUpTo(maxBytes: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream(minOf(maxBytes, 64 * 1024))
    val buffer = ByteArray(16 * 1024)
    while (output.size() < maxBytes) {
        val count = read(buffer, 0, minOf(buffer.size, maxBytes - output.size()))
        if (count < 0) break
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}

private const val MAX_MESSAGE_IMAGE_BASE64_CHARS = 16 * 1024 * 1024 + 16

private fun String.fileExtension(): String = when (lowercase()) {
    "image/jpeg", "image/jpg" -> "jpg"
    "image/webp" -> "webp"
    "image/gif" -> "gif"
    "image/heic" -> "heic"
    "image/heif" -> "heif"
    "image/avif" -> "avif"
    "image/heic-sequence" -> "heic"
    "image/heif-sequence" -> "heif"
    else -> "png"
}
