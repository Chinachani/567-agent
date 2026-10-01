package org.vetta.android.ui.chat

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ChatImeScrollBehaviorTest {
    @Test
    fun openingKeyboardScrollsToLatestMessageWhenAConversationExists() {
        assertEquals(8, chatImeScrollTarget(1, 8))
    }

    @Test
    fun hiddenKeyboardOrEmptyConversationDoesNotRequestScroll() {
        assertNull(chatImeScrollTarget(0, 8))
        assertNull(chatImeScrollTarget(300, -1))
    }
}
