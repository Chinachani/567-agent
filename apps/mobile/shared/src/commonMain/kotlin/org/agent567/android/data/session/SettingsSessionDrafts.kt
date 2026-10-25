package org.agent567.android.data.session

import com.russhwolf.settings.set
import kotlinx.serialization.Serializable
import org.agent567.android.core.settings.Agent567Settings
import org.agent567.android.core.net.Agent567Json
import org.agent567.android.domain.session.*
import kotlin.random.Random

/** Called under the owning SessionStore IO mutex. Payloads have separate keys from sent attachments. */
@OptIn(kotlin.io.encoding.ExperimentalEncodingApi::class)
internal class SettingsSessionDrafts(private val storage: Agent567Settings, private val files: MessageImageFileStore) {
    private fun key(session: String) = "agent567.session.drafts.v1.$session"
    private fun entries(session: String): List<DraftDto> = storage.getStringOrNull(key(session))?.let {
        Agent567Json.decodeFromString(DraftListDto.serializer(), it).items
    }.orEmpty()

    fun hasDraft(session: String): Boolean = entries(session).isNotEmpty()

    fun read(session: String, owner: String): SessionDraft {
        val draft = entries(session).firstOrNull { it.owner == owner } ?: return SessionDraft()
        fun bytes(item: DraftAttachmentDto): ByteArray = checkNotNull(files.readBytes(item.key)) { "Draft attachment unavailable" }
        return SessionDraft(draft.text,
            draft.images.map { MessageImage(it.id, it.mime, it.name, pendingBytes = bytes(it)) },
            draft.files.map { PendingFileAttachment(it.id, it.name.orEmpty(), it.mime, bytes(it), it.scope) })
    }

    fun write(session: String, owner: String, draft: SessionDraft) {
        require(draft.images.size <= 6 && draft.files.size <= 10)
        require(draft.files.sumOf { it.bytes.size.toLong() } <= 48L * 1024 * 1024)
        val all = entries(session)
        val old = all.firstOrNull { it.owner == owner }
        val written = mutableListOf<String>()
        fun persist(id: String, name: String?, mime: String, scope: String, bytes: () -> ByteArray, previous: List<DraftAttachmentDto>): DraftAttachmentDto {
            previous.firstOrNull { it.id == id }?.let { return it.copy(scope = scope) }
            val key = "draft-" + Random.nextLong().toULong().toString(16) + Random.nextLong().toULong().toString(16)
            check(files.writeBytes(key, bytes())) { "Draft attachment could not be saved" }
            written += key
            return DraftAttachmentDto(id, name, mime, key, scope)
        }
        try {
            val next = DraftDto(owner, draft.text,
                draft.images.map { image -> persist(image.id, image.fileName, image.mimeType, "", {
                    image.pendingBytes ?: image.storageKey?.let(files::readBytes)
                        ?: image.base64Data.takeIf { it.isNotBlank() }?.let { kotlin.io.encoding.Base64.decode(it.substringAfter(',', it)) }
                        ?: error("Draft image bytes unavailable")
                }, old?.images.orEmpty()) },
                draft.files.map { file -> persist(file.id, file.fileName, file.mimeType, file.readScope, { file.bytes }, old?.files.orEmpty()) })
            val remaining = all.filterNot { it.owner == owner } + listOf(next).filter { it.text.isNotEmpty() || it.images.isNotEmpty() || it.files.isNotEmpty() }
            if (remaining.isEmpty()) storage.remove(key(session))
            else storage[key(session)] = Agent567Json.encodeToString(DraftListDto.serializer(), DraftListDto(remaining))
            val retained = (next.images + next.files).map { it.key }.toSet()
            (old?.images.orEmpty() + old?.files.orEmpty()).filterNot { it.key in retained }.forEach { files.delete(it.key) }
        } catch (error: Throwable) {
            written.forEach(files::delete)
            throw error
        }
    }

    fun delete(session: String) {
        val all = entries(session)
        storage.remove(key(session))
        all.flatMap { it.images + it.files }.forEach { files.delete(it.key) }
    }
}

@Serializable private data class DraftListDto(val items: List<DraftDto> = emptyList())
@Serializable private data class DraftDto(val owner: String, val text: String, val images: List<DraftAttachmentDto>, val files: List<DraftAttachmentDto>)
@Serializable private data class DraftAttachmentDto(val id: String, val name: String?, val mime: String, val key: String, val scope: String = "")
