package org.agent567.android.data.session

import com.russhwolf.settings.MapSettings
import com.russhwolf.settings.set
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.agent567.android.core.model.ChatRole
import org.agent567.android.core.model.ChatQuestion
import org.agent567.android.core.model.ChatQuestionOption
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageImage
import org.agent567.android.domain.session.MessageImageFileStore
import org.agent567.android.domain.session.ConversationOrigin
import org.agent567.android.domain.session.MessageStatus
import org.agent567.android.domain.session.PendingQuestion
import org.agent567.android.domain.session.SessionStore
import org.agent567.android.domain.session.ToolTrace
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

class SettingsSessionStoreTest {
    @Test
    fun firstUserMessageDoesNotReplaceAiGeneratedTitle() =
        runBlocking {
            val store = SettingsSessionStore(MapSettings())
            val session = store.createSession()
            assertEquals(SessionStore.DEFAULT_TITLE, session.title)

            store.upsertMessage(
                LocalMessage(
                    id = "m1",
                    sessionId = session.id,
                    role = ChatRole.User,
                    content = "帮我写一封邮件给同事说明进度",
                    status = MessageStatus.Complete,
                    createdAtEpochMs = 1,
                ),
            )
            val updated = store.getSession(session.id)
            assertEquals(SessionStore.DEFAULT_TITLE, updated?.title)
            assertTrue(store.getMessages(session.id).size == 1)
        }

    @Test
    fun remoteMetadataPersistsAndLegacySessionsDefaultToCloud() =
        runBlocking {
            val settings = MapSettings()
            val firstStore = SettingsSessionStore(settings)
            val remote =
                firstStore.createSession(
                    title = "Desktop chat",
                    origin = ConversationOrigin.Desktop,
                    remoteDeviceId = "desktop-1",
                    remoteSessionId = "remote-session-1",
                    remoteSessionCreatedOnMobile = true,
                )

            val restored = SettingsSessionStore(settings).getSession(remote.id)
            assertEquals(ConversationOrigin.Desktop, restored?.origin)
            assertEquals("desktop-1", restored?.remoteDeviceId)
            assertEquals("remote-session-1", restored?.remoteSessionId)
            assertEquals(true, restored?.remoteSessionCreatedOnMobile)

            settings["vetta.session.index"] =
                """{"items":[{"id":"legacy","title":"Legacy","createdAtEpochMs":1,"updatedAtEpochMs":2}]}"""
            val legacy = SettingsSessionStore(settings).getSession("legacy")
            assertEquals(ConversationOrigin.Cloud, legacy?.origin)
            assertEquals(null, legacy?.remoteDeviceId)
        }

    @Test
    fun pendingQuestionPersistsWithAssistantMessage() =
        runBlocking {
            val settings = MapSettings()
            val firstStore = SettingsSessionStore(settings)
            val session = firstStore.createSession(origin = ConversationOrigin.Desktop)
            val pending =
                PendingQuestion(
                    sessionId = session.id,
                    requestId = "request-1",
                    questions =
                        listOf(
                            ChatQuestion(
                                question = "继续吗？",
                                options = listOf(ChatQuestionOption("继续", "继续执行当前任务")),
                            ),
                        ),
                )
            firstStore.upsertMessage(
                LocalMessage(
                    id = "assistant-1",
                    sessionId = session.id,
                    role = ChatRole.Assistant,
                    content = "",
                    status = MessageStatus.Streaming,
                    createdAtEpochMs = 1,
                    pendingQuestion = pending,
                ),
            )

            val restored = SettingsSessionStore(settings).getMessages(session.id).single().pendingQuestion
            assertEquals(pending, restored)
        }

    @Test
    fun toolPhaseLabelPersistsWithAssistantMessage() =
        runBlocking {
            val settings = MapSettings()
            val store = SettingsSessionStore(settings)
            val session = store.createSession(origin = ConversationOrigin.Desktop)
            store.upsertMessage(
                LocalMessage(
                    id = "assistant-tool",
                    sessionId = session.id,
                    role = ChatRole.Assistant,
                    content = "读取完成",
                    status = MessageStatus.Complete,
                    createdAtEpochMs = 1,
                    toolEvents = listOf(ToolTrace("completed", "call-1", "read_file", phaseLabel = "读取文件内容")),
                ),
            )

            val restored = SettingsSessionStore(settings).getMessages(session.id).single().toolEvents.single()
            assertEquals("读取文件内容", restored.phaseLabel)
        }

    @Test
    fun interruptedStreamingCheckpointRecoversPartialTextAsRetryableAndClearsIt() =
        runBlocking {
            val settings = MapSettings()
            val store = SettingsSessionStore(settings)
            val session = store.createSession(origin = ConversationOrigin.Desktop)
            store.upsertMessage(
                LocalMessage(
                    id = "user-1",
                    sessionId = session.id,
                    role = ChatRole.User,
                    content = "继续",
                    status = MessageStatus.Complete,
                    createdAtEpochMs = 1,
                ),
            )
            val assistant = LocalMessage(
                id = "assistant-1",
                sessionId = session.id,
                role = ChatRole.Assistant,
                content = "",
                status = MessageStatus.Streaming,
                createdAtEpochMs = 2,
            )
            store.upsertMessage(assistant)
            val indexBeforeStreaming = settings.getStringOrNull("vetta.session.messages.v2.${session.id}.index")
            val userRecordBeforeStreaming = settings.getStringOrNull("vetta.session.messages.v2.${session.id}.item.user-1")

            store.upsertStreamingMessage(assistant.copy(content = "部分回答"))

            assertEquals(indexBeforeStreaming, settings.getStringOrNull("vetta.session.messages.v2.${session.id}.index"))
            assertEquals(userRecordBeforeStreaming, settings.getStringOrNull("vetta.session.messages.v2.${session.id}.item.user-1"))
            val restored = SettingsSessionStore(settings).getMessages(session.id)
            assertEquals(listOf("继续", "部分回答"), restored.map { it.content })
            assertEquals(MessageStatus.Aborted, restored.last().status)
            assertEquals(null, settings.getStringOrNull("vetta.session.streaming.${session.id}"))

            val retry = org.agent567.android.domain.chat.prepareRetryTurn(restored)
            assertEquals("继续", retry?.draft)

            store.upsertMessage(assistant.copy(content = "完整回答", status = MessageStatus.Complete))

            assertEquals(null, settings.getStringOrNull("vetta.session.streaming.${session.id}"))
            assertEquals("完整回答", SettingsSessionStore(settings).getMessages(session.id).last().content)
        }

    @Test
    fun concurrentObserversReadTheSameMessagesPerSession() =
        runBlocking {
            val store = SettingsSessionStore(MapSettings())
            store.upsertMessage(
                LocalMessage(
                    id = "shared-message",
                    sessionId = "concurrent-session",
                    role = ChatRole.User,
                    content = "same snapshot",
                    status = MessageStatus.Complete,
                    createdAtEpochMs = 1,
                ),
            )
            val observed =
                coroutineScope {
                    (1..128)
                        .map { async(Dispatchers.Default) { store.observeMessages("concurrent-session").first() } }
                        .map { it.await() }
                }

            assertTrue(observed.all { it == observed.first() })
            assertEquals(listOf("same snapshot"), observed.first().map { it.content })
        }

    @Test
    @OptIn(ExperimentalEncodingApi::class)
    fun imagePayloadIsStoredOutsideMessageJsonAndSurvivesStoreRecreation() =
        runBlocking {
            val settings = MapSettings()
            val imageFiles = InMemoryMessageImageFileStore()
            val store = SettingsSessionStore(settings, imageFiles = imageFiles)
            val session = store.createSession()
            val bytes = "small image bytes".encodeToByteArray()
            store.upsertMessage(
                LocalMessage(
                    id = "message-with-image",
                    sessionId = session.id,
                    role = ChatRole.User,
                    content = "look",
                    status = MessageStatus.Complete,
                    createdAtEpochMs = 1,
                    images = listOf(MessageImage(id = "image-1", mimeType = "image/png", pendingBytes = bytes)),
                ),
            )

            val record = settings.getStringOrNull("vetta.session.messages.v2.${session.id}.item.message-with-image").orEmpty()
            assertFalse(record.contains(Base64.encode(bytes)))
            val restoredStore = SettingsSessionStore(settings, imageFiles = imageFiles)
            val restoredImage = restoredStore.getMessages(session.id).single().images.single()
            assertTrue(restoredImage.base64Data.isEmpty())
            assertTrue(restoredImage.storageKey != null)
            assertTrue(restoredStore.readMessageImageBytes(restoredImage)?.contentEquals(bytes) == true)
        }

    @Test
    @OptIn(ExperimentalEncodingApi::class)
    fun legacyMessageListMigratesImagesToFilesAndRemovesMonolithicJson() =
        runBlocking {
            val settings = MapSettings()
            val imageFiles = InMemoryMessageImageFileStore()
            val session = SettingsSessionStore(settings, imageFiles = imageFiles).createSession()
            val oldKey = "vetta.session.messages.${session.id}"
            settings.remove("vetta.session.messages.v2.${session.id}.index")
            val bytes = "legacy image".encodeToByteArray()
            settings[oldKey] =
                """{"items":[{"id":"legacy-message","sessionId":"${session.id}","role":"user","content":"old","status":"Complete","createdAtEpochMs":1,"images":[{"id":"legacy-image","mimeType":"image/png","base64Data":"${Base64.encode(bytes)}"}]}]}"""

            val migrated = SettingsSessionStore(settings, imageFiles = imageFiles).getMessages(session.id).single()

            assertTrue(migrated.images.single().storageKey != null)
            assertTrue(migrated.images.single().base64Data.isEmpty())
            assertEquals(null, settings.getStringOrNull(oldKey))
            assertTrue(imageFiles.readBytes(migrated.images.single().storageKey!!)?.contentEquals(bytes) == true)
        }

    private class InMemoryMessageImageFileStore : MessageImageFileStore {
        private val files = mutableMapOf<String, ByteArray>()

        override fun writeBytes(key: String, bytes: ByteArray): Boolean {
            files[key] = bytes.copyOf()
            return true
        }

        @OptIn(ExperimentalEncodingApi::class)
        override fun writeBase64(key: String, base64Data: String): Boolean =
            runCatching { writeBytes(key, Base64.decode(base64Data.substringAfter(',', base64Data))) }.getOrDefault(false)

        override fun readBytes(key: String): ByteArray? = files[key]?.copyOf()

        override fun delete(key: String) {
            files.remove(key)
        }
    }
}
