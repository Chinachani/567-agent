package org.agent567.android.ui.remote

import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.Agent567Theme
import org.agent567.android.app.ThemeMode
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

@Composable
internal fun RemoteImmersiveWindow() {
    val view = LocalView.current
    DisposableEffect(view) {
        val window = (view.parent as? DialogWindowProvider)?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        onDispose { controller?.show(WindowInsetsCompat.Type.systemBars()) }
    }
}

/** Overlay only: expanding controls never changes the video viewport or pointer mapping. */
@Composable
internal fun RemoteFullscreenToolbar(
    relativePointer: Boolean,
    directTouch: Boolean,
    canReset: Boolean,
    stats: String,
    details: String,
    onExit: () -> Unit,
    onDirectTouch: (Boolean) -> Unit,
    onReset: () -> Unit,
    onKeyboard: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    var help by remember { mutableStateOf(false) }
    var chooseInput by remember { mutableStateOf(false) }
    var statistics by remember { mutableStateOf(false) }
    Agent567Theme(ThemeMode.Dark) {
        Box(modifier.safeDrawingPadding(), contentAlignment = Alignment.TopCenter) {
            if (!expanded) {
                TextButton(onClick = { expanded = true }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface.copy(alpha = .8f)) {
                        Text(Str.remoteExpandControls, Modifier.padding(horizontal = 12.dp, vertical = 5.dp), style = MaterialTheme.typography.labelMedium)
                    }
                }
            } else Surface(color = MaterialTheme.colorScheme.surface.copy(alpha = .9f), shape = MaterialTheme.shapes.medium) {
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = onExit) { Text(Str.exitRemoteDesktopFullscreen, maxLines = 1) }
                    TextButton(onClick = { chooseInput = true }) { Text(if (relativePointer || !directTouch) Str.remoteTrackpad else Str.remoteTouch, maxLines = 1) }
                    TextButton(onClick = onReset, enabled = canReset) { Text(Str.remoteFitScreen, maxLines = 1) }
                    TextButton(onClick = { statistics = true }) { Text(stats, maxLines = 1) }
                    IconButton(onClick = onKeyboard) { Icon(Icons.Default.Keyboard, Str.remoteInputText) }
                    IconButton(onClick = { help = true }) { Icon(Icons.AutoMirrored.Filled.HelpOutline, Str.remoteHelp) }
                    TextButton(onClick = { expanded = false }) { Text(Str.collapse, maxLines = 1) }
                }
            }
        }
        if (chooseInput) AlertDialog(onDismissRequest = { chooseInput = false }, title = { Text(Str.remoteChooseInput) }, text = {
            Column {
                TextButton(onClick = { onDirectTouch(false); chooseInput = false }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("${Str.remoteTrackpad} · ${Str.remoteTrackpadOption}") }
                TextButton(onClick = { onDirectTouch(true); chooseInput = false }, enabled = !relativePointer, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("${Str.remoteTouch} · ${Str.remoteTouchOption}") }
                if (relativePointer) Text(Str.remoteDirectUnavailable, style = MaterialTheme.typography.bodySmall)
            }
        }, confirmButton = { TextButton(onClick = { chooseInput = false }) { Text(Str.close) } })
        if (help) AlertDialog(onDismissRequest = { help = false }, title = { Text(Str.remoteHelp) }, text = {
            Text(if (relativePointer || !directTouch) Str.remoteTrackpadHelp else Str.remoteTouchHelp)
        }, confirmButton = { TextButton(onClick = { help = false }) { Text(Str.remoteGotIt) } })
        if (statistics) AlertDialog(onDismissRequest = { statistics = false }, title = { Text(Str.connectionStatus) }, text = { Text(details.ifBlank { stats }) }, confirmButton = { TextButton(onClick = { statistics = false }) { Text(Str.close) } })
    }
}

@Composable
internal fun RemoteKeyboardShortcuts(onKey: (String, String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for ((label, code) in listOf("Esc" to "Escape", "Tab" to "Tab", Str.remoteBackspace to "Backspace", "Enter" to "Enter", "↑" to "ArrowUp", "↓" to "ArrowDown", "←" to "ArrowLeft", "→" to "ArrowRight")) {
            TextButton(modifier = Modifier.heightIn(min = 48.dp), onClick = { onKey(code, "down"); onKey(code, "up") }) { Text(label) }
        }
        for ((label, code) in listOf("Ctrl+C" to "KeyC", "Ctrl+V" to "KeyV")) {
            TextButton(onClick = {
                onKey("ControlLeft", "down")
                onKey(code, "down"); onKey(code, "up")
                onKey("ControlLeft", "up")
            }) { Text(label) }
        }
    }
}
