package org.agent567.android.ui.media

import androidx.compose.runtime.Composable
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.ImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.agent567.android.domain.session.MessageImage
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

const val MAX_PICKED_IMAGE_COUNT = 6
const val MAX_PICKED_IMAGE_BYTES = 4 * 1024 * 1024
const val MAX_MESSAGE_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024
const val MAX_MESSAGE_FILE_COUNT = 10
const val MAX_MESSAGE_FILE_BYTES = 12 * 1024 * 1024
const val MAX_MESSAGE_FILE_TOTAL_BYTES = 48 * 1024 * 1024

data class PickedImage(
    val mimeType: String,
    val fileName: String?,
    val bytes: ByteArray,
) {
    @OptIn(ExperimentalEncodingApi::class)
    fun toBase64(): String = Base64.encode(bytes)
}

data class PendingFileAttachment(
    val id: String,
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray,
)

data class PickedFileAttachment(
    val fileName: String,
    val mimeType: String,
    val bytes: ByteArray,
)

fun PendingFileAttachment.byteSize(): Int = bytes.size

fun MessageImage.pickedByteSize(): Int {
    pendingBytes?.let { return it.size }
    val payload = base64Data.substringAfter(',', base64Data).filterNot(Char::isWhitespace)
    return ((payload.length.toLong() * 3L) / 4L).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
}

expect fun imageBitmapFromBytes(bytes: ByteArray): ImageBitmap?

expect fun imageBitmapFromStorageKey(key: String): ImageBitmap?

@Composable
expect fun rememberImageCapture(
    onPicked: (PickedImage) -> Unit,
    onRejected: (Int) -> Unit,
): () -> Unit

@Composable
fun rememberMessageImageBitmap(image: MessageImage): MessageImageLoadState =
    produceState<MessageImageLoadState>(MessageImageLoadState.Loading, image.id, image.storageKey, image.base64Data, image.pendingBytes) {
        val bitmap = withContext(Dispatchers.IO) {
            when {
                image.storageKey != null -> imageBitmapFromStorageKey(image.storageKey)
                image.pendingBytes != null -> imageBitmapFromBytes(image.pendingBytes)
                image.base64Data.isNotBlank() -> imageBitmapFromBase64(image.base64Data)
                else -> null
            }
        }
        value = if (bitmap != null) MessageImageLoadState.Loaded(bitmap) else MessageImageLoadState.Failed
    }.value

sealed class MessageImageLoadState {
    object Loading : MessageImageLoadState()
    data class Loaded(val bitmap: ImageBitmap) : MessageImageLoadState()
    object Failed : MessageImageLoadState()
}

@OptIn(ExperimentalEncodingApi::class)
fun imageBitmapFromBase64(base64: String): ImageBitmap? =
    runCatching {
        val trimmed = base64.trim()
        val payload = trimmed.substringAfter(',', trimmed)
            .filterNot { it.isWhitespace() }
            .replace('-', '+')
            .replace('_', '/')
        val padded = payload + "=".repeat((4 - payload.length % 4) % 4)
        imageBitmapFromBytes(Base64.decode(padded))
    }.getOrNull()

/**
 * 平台图片选择器。返回启动函数；Android 走系统相册多选。
 */
@Composable
expect fun rememberImagePicker(
    onPicked: (List<PickedImage>) -> Unit,
    onRejected: (Int) -> Unit,
): () -> Unit

@Composable
expect fun rememberFileAttachmentPicker(
    onPicked: (List<PickedFileAttachment>) -> Unit,
    onRejected: () -> Unit,
): () -> Unit

/**
 * 平台图片保存到系统相册函数。返回 (image, onResult) -> Unit
 */
@Composable
expect fun rememberImageSaver(): (MessageImage, (Boolean, String) -> Unit) -> Unit
