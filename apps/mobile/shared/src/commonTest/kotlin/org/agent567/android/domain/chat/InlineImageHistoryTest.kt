package org.agent567.android.domain.chat

import com.russhwolf.settings.MapSettings
import org.agent567.android.core.model.ChatContentPart
import org.agent567.android.core.model.ChatRole
import org.agent567.android.data.session.SettingsSessionStore
import org.agent567.android.domain.session.ChatSession
import org.agent567.android.domain.session.LocalMessage
import org.agent567.android.domain.session.MessageImage
import org.agent567.android.domain.session.MessageStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.runBlocking

class InlineImageHistoryTest {
    private val raw = "Image ready\n\n![generated](data:image/png;base64," + "A".repeat(1_000_000)
    private val message = LocalMessage(
        id = "reply", sessionId = "chat", role = ChatRole.Assistant,
        content = raw, status = MessageStatus.Complete, createdAtEpochMs = 2,
        images = listOf(MessageImage(id = "gen-existing", mimeType = "image/png", base64Data = "AA==")),
    )

    @Test fun legacyInlinePixelsAreNotResentAsTextAndStoredImageIsPreserved() {
        val request = message.toChatMessage()

        assertFalse(request.textContent.contains("data:image/"))
        assertTrue(request.textContent.length < 100)
        assertEquals(1, request.parts.filterIsInstance<ChatContentPart.Image>().size)
        assertEquals(raw, message.content)
    }

    @Test fun contextEstimateUsesTheSameTextAsTheRequestWithoutRewritingHistory() {
        val manager = MobileContextManager(SettingsSessionStore(MapSettings())) { _, _, _ -> error("No model call") }
        val session = ChatSession("chat", "image", "model", null, 1, 2)
        val prompt = LocalMessage("prompt", "chat", ChatRole.User, "draw", MessageStatus.Complete, 1)
        val state = manager.snapshot(session, listOf(prompt, message), 1_048_576)

        assertTrue(requireNotNull(state.tokens) < 3_000)
        val workspace = requireNotNull(state.workspace)
        assertEquals(1, workspace.turns.size)
        assertFalse(workspace.turns.any { it.text.contains("data:image/") })
        assertEquals(raw, message.content)
    }

    @Test fun reloadedLegacyHistoryCompactsWithoutSendingPixelsAsTextOrRewritingTheOriginal() = runBlocking {
        val storage = MapSettings()
        val store = SettingsSessionStore(storage)
        val session = store.createSession("Legacy images", modelId = "model")
        val legacy = message.copy(sessionId = session.id, content = "Image ready\n\n![generated](data:image/png;base64," + "A".repeat(800_000), images = emptyList())
        store.upsertMessage(LocalMessage("prompt", session.id, ChatRole.User, "draw", MessageStatus.Complete, 1))
        store.upsertMessage(legacy)
        store.upsertMessage(LocalMessage("next", session.id, ChatRole.User, "explain", MessageStatus.Complete, 3))
        val reloaded = SettingsSessionStore(storage)
        var summaries = 0
        val manager = MobileContextManager(reloaded) { _, request, _ ->
            summaries++
            assertTrue(request.all { !it.textContent.contains("data:image/") && it.textContent.length < 2_000 })
            "Image ready."
        }
        assertTrue(manager.compact(session.id, "model", 32_000, manual = true))
        assertEquals(1, summaries)
        assertEquals(legacy.content, reloaded.getMessages(session.id).single { it.id == legacy.id }.content)
        assertEquals("Image ready.", reloaded.getSession(session.id)?.context?.summary)
    }
}
