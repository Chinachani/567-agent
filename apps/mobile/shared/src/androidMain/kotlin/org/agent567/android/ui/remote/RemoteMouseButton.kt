package org.agent567.android.ui.remote

import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str

/** A short press clicks. A deliberate hold owns the down edge until release or cancellation. */
@Composable
internal fun RemoteMouseButton(label: String, enabled: Boolean, click: () -> Unit, hold: () -> (() -> Unit)?) {
    val latestClick by rememberUpdatedState(click)
    val latestHold by rememberUpdatedState(hold)
    var holding by remember { mutableStateOf(false) }
    Box(Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp).semantics(mergeDescendants = true) {
        role = Role.Button
        if (enabled) onClick { latestClick(); true } else disabled()
        if (holding) stateDescription = Str.remoteMouseHeld
    }.onKeyEvent {
        if (!enabled || it.key !in listOf(Key.Enter, Key.Spacebar, Key.DirectionCenter)) false
        else { if (it.type == KeyEventType.KeyUp) latestClick(); true }
    }.focusable(enabled).pointerInput(enabled) {
        if (!enabled) return@pointerInput
        var release: (() -> Unit)? = null
        fun finish() { val up = release; release = null; holding = false; up?.invoke() }
        try {
            detectTapGestures(
                onPress = { try { tryAwaitRelease() } finally { finish() } },
                onLongPress = { release = latestHold(); holding = release != null },
                onTap = { latestClick() },
            )
        } finally { finish() }
    }.padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        Text(label, color = when { !enabled -> LocalContentColor.current.copy(alpha = .38f)
            holding -> MaterialTheme.colorScheme.tertiary
            else -> MaterialTheme.colorScheme.primary }, style = MaterialTheme.typography.labelLarge, maxLines = 1)
    }
}
