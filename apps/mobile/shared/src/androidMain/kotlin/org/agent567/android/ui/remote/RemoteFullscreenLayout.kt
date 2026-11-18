package org.agent567.android.ui.remote

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.dp

/** Only the controls avoid the keyboard. Video size and pointer coordinates stay fixed. */
@Composable
internal fun RemoteFullscreenLayout(
    video: @Composable () -> Unit,
    toolbar: @Composable () -> Unit,
    controls: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    keyboardOpen: Boolean = false,
    imeInsets: WindowInsets = WindowInsets.ime,
    banner: @Composable () -> Unit = {},
    onBottomInsetChanged: (Float) -> Unit = {},
) {
    var rootHeight by remember { mutableIntStateOf(0) }
    var rootTop by remember { mutableFloatStateOf(0f) }
    var controlsTop by remember { mutableStateOf<Float?>(null) }
    val latestOnBottomInsetChanged by rememberUpdatedState(onBottomInsetChanged)
    val toolbarState = rememberSaveableStateHolder()
    LaunchedEffect(keyboardOpen, rootHeight, rootTop, controlsTop) {
        val inset = if (keyboardOpen) controlsTop?.let { (rootHeight - (it - rootTop)).coerceAtLeast(0f) } ?: 0f else 0f
        latestOnBottomInsetChanged(inset)
    }
    Box(
        modifier.fillMaxSize().onGloballyPositioned { coords ->
            rootHeight = coords.size.height
            rootTop = coords.positionInRoot().y
        },
    ) {
        Box(Modifier.matchParentSize()) { video() }
        Box(Modifier.align(Alignment.TopCenter).displayCutoutPadding()) { banner() }
        if (keyboardOpen) Box(
            Modifier.align(Alignment.BottomCenter)
                .windowInsetsPadding(imeInsets)
                .navigationBarsPadding()
                .displayCutoutPadding()
                .padding(8.dp)
                .onGloballyPositioned { coords ->
                    controlsTop = if (coords.size.height > 0) coords.positionInRoot().y else null
                },
        ) { controls() } else Box(
            Modifier.align(Alignment.BottomCenter).displayCutoutPadding().navigationBarsPadding().padding(6.dp),
        ) {
            toolbarState.SaveableStateProvider("pointer-toolbar") { toolbar() }
        }
    }
}
