package org.agent567.android.ui.remote

import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.Agent567Theme
import org.agent567.android.app.ThemeMode
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.DragHandle
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import android.view.WindowManager

@Composable
internal fun RemoteImmersiveWindow() {
    val view = LocalView.current
    DisposableEffect(view) {
        val window = (view.parent as? DialogWindowProvider)?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        val previousSoftInputMode = window?.attributes?.softInputMode
        window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)
        controller?.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller?.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            controller?.show(WindowInsetsCompat.Type.systemBars())
            window?.let { it.setSoftInputMode(previousSoftInputMode ?: WindowManager.LayoutParams.SOFT_INPUT_ADJUST_UNSPECIFIED) }
        }
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
    onMouseButton: (String) -> Unit = {},
    inputEnabled: Boolean = true,
    onConnectionPanel: (() -> Unit)? = null,
    onMouseHold: (String) -> (() -> Unit)? = { null },
    pointerSpeed: Int = 1,
    onPointerSpeed: ((Int) -> Unit)? = null,
    handleModifier: Modifier = Modifier,
    showMouse: Boolean = false,
    onShowMouse: (Boolean) -> Unit = {},
    useDraft: Boolean = false,
    onUseDraft: ((Boolean) -> Unit)? = null,
    textAvailable: Boolean = true,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var help by remember { mutableStateOf(false) }
    var chooseInput by remember { mutableStateOf(false) }
    var statistics by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    Agent567Theme(ThemeMode.Dark) {
        Box(modifier, contentAlignment = Alignment.CenterEnd) {
            if (!expanded) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primary.copy(alpha = .92f)) {
                    IconButton(onClick = { expanded = true }, modifier = handleModifier.size(48.dp)) {
                        Icon(Icons.Default.ChevronLeft, if (inputEnabled) Str.remoteExpandControls else "${Str.remoteExpandControls} · ${Str.viewOnly}")
                    }
                }
            } else Surface(color = MaterialTheme.colorScheme.surface.copy(alpha = .9f), shape = MaterialTheme.shapes.medium) {
                Row(Modifier.padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Row(Modifier.weight(1f, fill = false).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                        IconButton(enabled = inputEnabled, onClick = { expanded = false; onKeyboard() }) { Icon(Icons.Default.Keyboard, Str.remoteSystemKeyboard) }
                        RemoteMouseButton(Str.remoteLeftButton, inputEnabled, { onMouseButton("left") }, { onMouseHold("left") })
                        RemoteMouseButton(Str.remoteRightButton, inputEnabled, { onMouseButton("right") }, { onMouseHold("right") })
                        TextButton(onClick = { chooseInput = true }, modifier = Modifier.heightIn(min = 48.dp)
                            .semantics { onClick(label = Str.remoteChooseInput, action = null) }) {
                            Text(if (relativePointer || !directTouch) Str.remoteTrackpad else Str.remoteTouch, maxLines = 1)
                        }
                    }
                    Box {
                        IconButton(onClick = { more = true }) { Icon(Icons.Default.MoreVert, Str.remoteMoreControls) }
                        DropdownMenu(expanded = more, onDismissRequest = { more = false }) {
                            if (onUseDraft != null) DropdownMenuItem(text = { Column {
                                Text(Str.remoteUseDraft)
                                Text(if (!textAvailable) Str.remoteTextInputUpdate else Str.remoteUseDraftHint, style = MaterialTheme.typography.labelSmall)
                            } },
                                leadingIcon = { Checkbox(checked = useDraft || !textAvailable, onCheckedChange = null) },
                                enabled = textAvailable, onClick = { more = false; onUseDraft(!useDraft) })
                            DropdownMenuItem(text = { Text(Str.remoteFitScreen) }, enabled = canReset, onClick = { more = false; onReset() })
                            DropdownMenuItem(
                                text = { Text(if (stats == Str.connectionStatus) stats else "${Str.connectionStatus} · $stats") },
                                onClick = {
                                    more = false
                                    if (onConnectionPanel != null) onConnectionPanel() else statistics = true
                                },
                            )
                            DropdownMenuItem(text = { Text(Str.remoteHelp) }, onClick = { more = false; help = true })
                            HorizontalDivider()
                            DropdownMenuItem(text = { Text(Str.exitRemoteDesktopFullscreen) }, onClick = { more = false; onExit() })
                        }
                    }
                    IconButton(onClick = { expanded = false }, modifier = handleModifier.size(48.dp)) { Icon(Icons.Default.ChevronRight, Str.collapse) }
                }
            }
        }
        if (chooseInput) AlertDialog(onDismissRequest = { chooseInput = false }, title = { Text(Str.remoteChooseInput) }, text = {
            Column(Modifier.verticalScroll(rememberScrollState()).selectableGroup()) {
                val tabletSelected = directTouch && !relativePointer
                RemoteModeOption("${Str.remoteTrackpad} · ${Str.remoteTrackpadOption}", selected = !tabletSelected) {
                    onDirectTouch(false); chooseInput = false
                }
                RemoteModeOption("${Str.remoteTouch} · ${Str.remoteTouchOption}", selected = tabletSelected, enabled = !relativePointer) {
                    onDirectTouch(true); chooseInput = false
                }
                if (relativePointer) Text(Str.remoteDirectUnavailable, style = MaterialTheme.typography.bodySmall)
                Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(showMouse, role = Role.Checkbox, onValueChange = onShowMouse),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Checkbox(checked = showMouse, onCheckedChange = null)
                    Text(Str.remoteFloatingMouse)
                }
                if (!tabletSelected && onPointerSpeed != null) {
                    HorizontalDivider()
                    Text(Str.remotePointerSpeed, style = MaterialTheme.typography.labelLarge)
                    Row(Modifier.horizontalScroll(rememberScrollState()).selectableGroup(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        listOf(Str.remotePointerPrecise, Str.remotePointerStandard, Str.remotePointerFast).forEachIndexed { index, label ->
                            FilterChip(selected = pointerSpeed == index, onClick = { onPointerSpeed(index) }, label = { Text(label) })
                        }
                    }
                }
            }
        }, confirmButton = { TextButton(onClick = { chooseInput = false }, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.close) } })
        if (help) AlertDialog(onDismissRequest = { help = false }, title = { Text(Str.remoteHelp) }, text = {
            val trackpad = relativePointer || !directTouch
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (inputEnabled) {
                    Text("${Str.remoteHelpComputer} · ${if (trackpad) Str.remoteTrackpad else Str.remoteTouch}",
                        Modifier.semantics { heading() }, style = MaterialTheme.typography.titleSmall)
                    Text(if (trackpad) Str.remoteTrackpadHelp else Str.remoteTouchHelp)
                    Text(Str.remoteHelpScroll)
                } else Text(Str.remoteHelpViewOnly)
                Text(Str.remoteHelpLocal, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleSmall)
                Text(Str.remoteHelpLocalGestures)
            }
        }, confirmButton = { TextButton(onClick = { help = false }, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.remoteGotIt) } },
            dismissButton = if (inputEnabled) ({ TextButton(onClick = { help = false; chooseInput = true }) { Text(Str.remoteChooseInput) } }) else null)
        if (statistics) AlertDialog(onDismissRequest = { statistics = false }, title = { Text(Str.connectionStatus) }, text = { Text(details.ifBlank { stats }) }, confirmButton = { TextButton(onClick = { statistics = false }, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.close) } })
    }
}

@Composable
internal fun RemoteFloatingMouse(grip: Modifier, onClick: (String) -> Unit, onHold: (String) -> (() -> Unit)?, onScroll: (Float) -> Unit) {
    Surface(shape = MaterialTheme.shapes.large, color = androidx.compose.ui.graphics.Color.Black.copy(alpha = .65f), contentColor = androidx.compose.ui.graphics.Color.White) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { onScroll(-40f) }) { Icon(Icons.Default.KeyboardArrowUp, Str.remoteScrollUp) }
                IconButton(onClick = { onScroll(40f) }) { Icon(Icons.Default.KeyboardArrowDown, Str.remoteScrollDown) }
            }
            Box(grip.size(96.dp, 32.dp), contentAlignment = Alignment.Center) { Icon(Icons.Default.DragHandle, Str.remoteMoveMouse) }
            Row {
                RemoteMouseButton(Str.remoteLeftButton, true, { onClick("left") }, { onHold("left") }, leftFace = true)
                RemoteMouseButton(Str.remoteRightButton, true, { onClick("right") }, { onHold("right") }, leftFace = false)
            }
        }
    }
}

@Composable
private fun RemoteModeOption(label: String, selected: Boolean, enabled: Boolean = true, onSelect: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onSelect)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        RadioButton(selected = selected, enabled = enabled, onClick = null)
        Text(label, color = if (enabled) LocalContentColor.current else MaterialTheme.colorScheme.onSurface.copy(alpha = .38f))
    }
}
