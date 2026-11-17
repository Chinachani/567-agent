package org.agent567.android.ui.remote

import android.content.Context
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str

private data class RemoteShortcut(val id: String, val label: String, val keys: List<String>)
private val shortcuts = listOf(
    RemoteShortcut("escape", "Esc", listOf("Escape")),
    RemoteShortcut("tab", "Tab", listOf("Tab")),
    RemoteShortcut("backspace", Str.remoteBackspace, listOf("Backspace")),
    RemoteShortcut("enter", "Enter", listOf("Enter")),
    RemoteShortcut("up", "↑", listOf("ArrowUp")),
    RemoteShortcut("down", "↓", listOf("ArrowDown")),
    RemoteShortcut("left", "←", listOf("ArrowLeft")),
    RemoteShortcut("right", "→", listOf("ArrowRight")),
    RemoteShortcut("copy", Str.remoteShortcutCopy, listOf("ControlLeft", "KeyC")),
    RemoteShortcut("paste", Str.remoteShortcutPaste, listOf("ControlLeft", "KeyV")),
    RemoteShortcut("all", Str.remoteShortcutSelectAll, listOf("ControlLeft", "KeyA")),
    RemoteShortcut("undo", Str.remoteShortcutUndo, listOf("ControlLeft", "KeyZ")),
    RemoteShortcut("save", Str.remoteShortcutSave, listOf("ControlLeft", "KeyS")),
)

@Composable
internal fun RemoteKeyboardShortcuts(onKey: (String, String) -> Unit, enabled: Boolean = true) {
    val context = LocalContext.current
    val preferences = remember(context) { context.getSharedPreferences("remote-controls", Context.MODE_PRIVATE) }
    var order by remember(preferences) { mutableStateOf(
        preferences.getString("shortcuts-v1", null)?.split(",")?.distinct()?.filter { id -> shortcuts.any { it.id == id } }
            ?: shortcuts.take(10).map { it.id }
    ) }
    var configure by remember { mutableStateOf(false) }
    fun update(ids: List<String>) { order = ids; preferences.edit().putString("shortcuts-v1", ids.joinToString(",")).apply() }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        order.mapNotNull { id -> shortcuts.find { it.id == id } }.forEach { shortcut ->
            TextButton(enabled = enabled, modifier = Modifier.heightIn(min = 48.dp), onClick = {
                try { shortcut.keys.forEach { onKey(it, "down") } }
                finally { shortcut.keys.asReversed().forEach { onKey(it, "up") } }
            }) { Text(shortcut.label) }
        }
        TextButton(onClick = { configure = true }, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.remoteCustomizeShortcuts) }
    }
    if (configure) AlertDialog(onDismissRequest = { configure = false }, title = { Text(Str.remoteCustomizeShortcuts) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            Text(Str.remoteShortcutsHint, style = MaterialTheme.typography.bodySmall)
            (order + shortcuts.map { it.id }.filter { it !in order }).forEach { id ->
                val shortcut = shortcuts.first { it.id == id }
                val index = order.indexOf(id)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = index >= 0, onCheckedChange = { checked -> update(if (checked) order + id else order - id) })
                    Text(shortcut.label, Modifier.weight(1f))
                    TextButton(enabled = index > 0, onClick = {
                        update(order.toMutableList().also { it[index] = it[index - 1]; it[index - 1] = id })
                    }) { Text(Str.remoteShortcutMoveUp) }
                }
            }
        }
    }, confirmButton = { TextButton(onClick = { configure = false }) { Text(Str.close) } })
}
