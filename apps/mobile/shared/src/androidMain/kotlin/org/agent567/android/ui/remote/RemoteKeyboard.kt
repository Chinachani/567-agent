package org.agent567.android.ui.remote

/** Android native keycodes, not Compose's packed Long key identifiers. */
internal fun androidRemoteKeyCode(code: Int): String? = when {
    code in 29..54 -> "Key${('A'.code + code - 29).toChar()}"
    code in 7..16 -> "Digit${code - 7}"
    code in 131..142 -> "F${code - 130}"
    else -> mapOf(
        66 to "Enter", 111 to "Escape", 67 to "Backspace", 61 to "Tab", 62 to "Space",
        19 to "ArrowUp", 20 to "ArrowDown", 21 to "ArrowLeft", 22 to "ArrowRight", 112 to "Delete",
        57 to "AltLeft", 58 to "AltRight", 59 to "ShiftLeft", 60 to "ShiftRight",
        113 to "ControlLeft", 114 to "ControlRight", 117 to "MetaLeft", 118 to "MetaRight",
        68 to "Backquote", 69 to "Minus", 70 to "Equal", 71 to "BracketLeft", 72 to "BracketRight",
        73 to "Backslash", 74 to "Semicolon", 75 to "Quote", 55 to "Comma", 56 to "Period", 76 to "Slash",
        92 to "PageUp", 93 to "PageDown", 122 to "Home", 123 to "End", 124 to "Insert",
    )[code]
}
