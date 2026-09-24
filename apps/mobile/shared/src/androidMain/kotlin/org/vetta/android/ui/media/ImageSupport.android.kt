package org.vetta.android.ui.media

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext

actual fun imageBitmapFromBytes(bytes: ByteArray): ImageBitmap? {
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
    return bitmap.asImageBitmap()
}

@Composable
actual fun rememberImagePicker(onPicked: (List<PickedImage>) -> Unit): () -> Unit {
    val context = LocalContext.current
    val launcher =
        rememberLauncherForActivityResult(
            contract = ActivityResultContracts.GetMultipleContents(),
        ) { uris ->
            val picked =
                uris.mapNotNull { uri ->
                    runCatching {
                        val mime = context.contentResolver.getType(uri) ?: "image/jpeg"
                        if (!mime.startsWith("image/")) return@runCatching null
                        val bytes =
                            context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                                ?: return@runCatching null
                        // 限制单图约 4MB，避免 Settings 持久化爆表
                        if (bytes.size > 4 * 1024 * 1024) return@runCatching null
                        val name = uri.lastPathSegment
                        PickedImage(mimeType = mime, fileName = name, bytes = bytes)
                    }.getOrNull()
                }
            if (picked.isNotEmpty()) {
                onPicked(picked)
            }
        }
    return remember(launcher) {
        { launcher.launch("image/*") }
    }
}

@Composable
actual fun rememberImageSaver(): (String, (Boolean, String) -> Unit) -> Unit {
    val context = LocalContext.current
    return remember(context) {
        { base64Data, onResult ->
            try {
                val cleanB64 = if (base64Data.contains(",")) base64Data.substringAfter(",") else base64Data
                val bytes = android.util.Base64.decode(cleanB64, android.util.Base64.DEFAULT)
                val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                if (bitmap == null) {
                    onResult(false, "图片解析失败")
                } else {
                    val filename = "567_Agent_${System.currentTimeMillis()}.png"
                    var saved = false
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                        val contentValues = android.content.ContentValues().apply {
                            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, filename)
                            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "image/png")
                            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_PICTURES + "/567Agent")
                        }
                        val uri = context.contentResolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, contentValues)
                        if (uri != null) {
                            context.contentResolver.openOutputStream(uri)?.use { os ->
                                saved = bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, os)
                            }
                        }
                    } else {
                        val imagesDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES)
                        val appDir = java.io.File(imagesDir, "567Agent").apply { if (!exists()) mkdirs() }
                        val file = java.io.File(appDir, filename)
                        java.io.FileOutputStream(file).use { os ->
                            saved = bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, os)
                        }
                        // 触发系统相册扫描
                        android.media.MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf("image/png"), null)
                    }
                    if (saved) {
                        onResult(true, "图片已保存至系统相册")
                    } else {
                        onResult(false, "保存失败，请检查存储权限")
                    }
                }
            } catch (e: Exception) {
                onResult(false, "保存异常: ${e.message}")
            }
        }
    }
}
