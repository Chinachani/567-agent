package org.agent567.android.ui.remote

import android.content.Context
import android.text.Editable
import android.text.InputType
import android.text.Selection
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.agent567.android.ui.i18n.Str

@Composable
internal fun RemoteDirectTyping(onText: (String) -> Boolean, onKey: (String, String) -> Unit, onDismiss: () -> Unit) {
    var showKeys by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<String?>(null) }
    val modifiers = remember { mutableStateListOf<String>() }
    val currentKey by rememberUpdatedState(onKey)
    fun setModifier(code: String, down: Boolean) {
        if (down == (code in modifiers)) return
        if (down) modifiers.add(code) else modifiers.remove(code)
        currentKey(code, if (down) "down" else "up")
    }
    DisposableEffect(showKeys) { onDispose { modifiers.toList().asReversed().forEach { setModifier(it, false) } } }
    fun press(code: String) { currentKey(code, "down"); currentKey(code, "up") }
    Box {
        RemoteSystemKeyboard(onText = { text ->
            feedback = when {
                text.length > 256 -> Str.remoteImeTooLong
                modifiers.isNotEmpty() -> {
                    val code = text.singleOrNull()?.let(::remoteShortcutKey)
                    if (code == null) Str.remoteModifierHint else { press(code); null }
                }
                text.all { it == ' ' || it == '\n' || it == '\t' } -> {
                    text.forEach {
                        val code = when (it) { ' ' -> "Space"; '\n' -> "Enter"; else -> "Tab" }
                        press(code)
                    }
                    null
                }
                onText(text) -> null
                else -> Str.remoteImeNotSent
            }
        }, onKey = { code, down -> if (code !in modifiers) onKey(code, if (down) "down" else "up") })
        Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surface.copy(alpha = .88f)) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconToggleButton(checked = showKeys, onCheckedChange = { showKeys = it }) {
                        Icon(Icons.Default.MoreVert, Str.remoteKeyboardTools)
                    }
                    TextButton(onClick = onDismiss) { Text(Str.remoteHideKeyboard) }
                }
                if (showKeys) {
                    Row(Modifier.horizontalScroll(rememberScrollState())) {
                        for ((label, code) in remoteModifiers) {
                            RemoteHoldButton(label, true, { setModifier(code, code !in modifiers) }, {
                                if (code in modifiers) null else {
                                    setModifier(code, true)
                                    val release: () -> Unit = { setModifier(code, false) }
                                    release
                                }
                            }) {
                                Surface(color = if (code in modifiers) MaterialTheme.colorScheme.primaryContainer else androidx.compose.ui.graphics.Color.Transparent,
                                    shape = MaterialTheme.shapes.small) { Text(label, Modifier.padding(4.dp)) }
                            }
                        }
                    }
                    RemoteKeyboardShortcuts({ code, action -> if (code !in modifiers) onKey(code, action) })
                }
                feedback?.let { Text(it, Modifier.padding(horizontal = 8.dp), style = MaterialTheme.typography.labelSmall) }
            }
        }
    }
}

private val remoteModifiers = listOf("Ctrl" to "ControlLeft", "Alt" to "AltLeft", "Shift" to "ShiftLeft", "Win" to "MetaLeft")
private const val imeAnchor = "\u200B"

private fun remoteShortcutKey(char: Char): String? = when (char) {
    in 'a'..'z', in 'A'..'Z' -> "Key${char.uppercaseChar()}"
    in '0'..'9' -> "Digit$char"
    ' ' -> "Space"; '\n' -> "Enter"; '\t' -> "Tab"
    ',' -> "Comma"; '.' -> "Period"; '/' -> "Slash"; '-' -> "Minus"; '=' -> "Equal"
    ';' -> "Semicolon"; '\'' -> "Quote"; '[' -> "BracketLeft"; ']' -> "BracketRight"
    '\\' -> "Backslash"; '`' -> "Backquote"
    else -> null
}

@Composable
private fun RemoteSystemKeyboard(onText: (String) -> Unit, onKey: (String, Boolean) -> Unit) {
    AndroidView(
        modifier = Modifier.size(1.dp),
        factory = { RemoteImeView(it) },
        update = { it.commit = onText; it.key = onKey },
        onRelease = { it.disconnect() },
    )
}

private class RemoteImeView(context: Context) : View(context) {
    var commit: (String) -> Unit = {}
    var key: (String, Boolean) -> Unit = { _, _ -> }
    private var generation = 0
    private var opening = true

    init {
        isFocusableInTouchMode = true
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    override fun onCheckIsTextEditor() = true

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        post { openWhenReady() }
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        if (hasWindowFocus) post { openWhenReady() }
    }

    private fun openWhenReady() {
        if (opening && isAttachedToWindow && hasWindowFocus() && requestFocus()) {
            opening = !context.getSystemService(InputMethodManager::class.java).showSoftInput(this, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    fun disconnect() {
        generation++
        opening = false
        commit = {}
        key = { _, _ -> }
    }

    override fun onDetachedFromWindow() {
        disconnect()
        super.onDetachedFromWindow()
    }

    private fun press(code: String) { key(code, true); key(code, false) }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val code = androidRemoteKeyCode(keyCode) ?: return super.onKeyDown(keyCode, event)
        key(code, true)
        return true
    }

    override fun onKeyUp(keyCode: Int, event: KeyEvent): Boolean {
        val code = androidRemoteKeyCode(keyCode) ?: return super.onKeyUp(keyCode, event)
        key(code, false)
        return true
    }

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
        outAttrs.inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
        outAttrs.imeOptions = EditorInfo.IME_ACTION_NONE or EditorInfo.IME_FLAG_NO_EXTRACT_UI or EditorInfo.IME_FLAG_NO_FULLSCREEN or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
        outAttrs.initialSelStart = imeAnchor.length
        outAttrs.initialSelEnd = imeAnchor.length
        val owner = ++generation
        return object : BaseInputConnection(this, true) {
            private var batchDepth = 0
            private var initialized = false
            private fun active() = owner == generation && isAttachedToWindow && isFocused

            private fun resetBuffer(buffer: Editable) {
                buffer.replace(0, buffer.length, imeAnchor)
                Selection.setSelection(buffer, buffer.length)
            }

            override fun getEditable(): Editable = requireNotNull(super.getEditable()).also {
                if (!initialized) { initialized = true; resetBuffer(it) }
            }

            override fun beginBatchEdit(): Boolean { batchDepth++; return true }
            override fun endBatchEdit(): Boolean {
                if (batchDepth > 0) batchDepth--
                if (batchDepth == 0 && active()) editable.let { buffer ->
                    context.getSystemService(InputMethodManager::class.java).updateSelection(this@RemoteImeView,
                        Selection.getSelectionStart(buffer), Selection.getSelectionEnd(buffer), getComposingSpanStart(buffer), getComposingSpanEnd(buffer))
                }
                return batchDepth > 0
            }

            private fun flush() {
                val buffer = editable
                val text = buffer.toString().removePrefix(imeAnchor)
                resetBuffer(buffer)
                if (text.isNotEmpty() && active()) commit(text)
            }

            override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
                if (!active()) return false
                val deletingAnchor = text.isNullOrEmpty() && editable.toString() == imeAnchor && getComposingSpanStart(editable) < 0 &&
                    Selection.getSelectionStart(editable) != Selection.getSelectionEnd(editable)
                beginBatchEdit()
                try { super.commitText(text ?: "", newCursorPosition); flush() } finally { endBatchEdit() }
                if (deletingAnchor) press("Backspace")
                return true
            }

            override fun finishComposingText(): Boolean {
                val hadComposition = getComposingSpanStart(editable) >= 0
                beginBatchEdit()
                return try {
                    val result = super.finishComposingText()
                    if (hadComposition) flush()
                    result
                } finally { endBatchEdit() }
            }

            @androidx.annotation.RequiresApi(34)
            override fun replaceText(start: Int, end: Int, text: CharSequence, newCursorPosition: Int, textAttribute: android.view.inputmethod.TextAttribute?): Boolean {
                if (!active()) return false
                beginBatchEdit()
                return try {
                    val result = super.replaceText(start, end, text, newCursorPosition, textAttribute)
                    if (result) flush()
                    result
                } finally { endBatchEdit() }
            }

            override fun closeConnection() {
                if (owner == generation) generation++
                super.closeConnection()
            }

            private fun deleteRemote(before: Int, after: Int): Boolean {
                if (!active() || before !in 0..256 || after !in 0..256) return false
                repeat(before) { press("Backspace") }; repeat(after) { press("Delete") }
                return true
            }

            private fun deleteAround(before: Int, after: Int, codePoints: Boolean): Boolean {
                if (!active() || before < 0 || after < 0) return false
                val buffer = editable
                val floor = if (buffer.startsWith(imeAnchor)) imeAnchor.length else 0
                if (buffer.length == floor) return deleteRemote(before, after)
                val cursor = Selection.getSelectionEnd(buffer).coerceIn(floor, buffer.length)
                val start = if (codePoints) Character.offsetByCodePoints(buffer, cursor, -minOf(before, Character.codePointCount(buffer, floor, cursor)))
                    else cursor - minOf(before, cursor - floor)
                val end = if (codePoints) Character.offsetByCodePoints(buffer, cursor, minOf(after, Character.codePointCount(buffer, cursor, buffer.length)))
                    else cursor + minOf(after, buffer.length - cursor)
                beginBatchEdit()
                try { buffer.delete(start, end); Selection.setSelection(buffer, start) } finally { endBatchEdit() }
                return true
            }

            override fun deleteSurroundingText(beforeLength: Int, afterLength: Int) = deleteAround(beforeLength, afterLength, false)

            override fun deleteSurroundingTextInCodePoints(beforeLength: Int, afterLength: Int) = deleteAround(beforeLength, afterLength, true)

            override fun performEditorAction(actionCode: Int): Boolean {
                if (!active()) return false
                finishComposingText()
                press("Enter")
                return true
            }

            override fun sendKeyEvent(event: KeyEvent): Boolean {
                if (!active()) return false
                if (event.keyCode == KeyEvent.KEYCODE_DEL && getComposingSpanStart(editable) >= 0) {
                    if (event.action == KeyEvent.ACTION_DOWN) deleteAround(1, 0, true)
                    return true
                }
                return this@RemoteImeView.dispatchKeyEvent(event)
            }
        }
    }
}
