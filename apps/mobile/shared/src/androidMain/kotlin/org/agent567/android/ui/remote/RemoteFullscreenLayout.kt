package org.agent567.android.ui.remote

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
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
    imeInsets: WindowInsets = WindowInsets.ime,
    banner: @Composable () -> Unit = {},
    onBottomInsetChanged: (Float) -> Unit = {},
) {
    var rootHeight by remember { mutableIntStateOf(0) }
    var rootTop by remember { mutableFloatStateOf(0f) }
    var controlsTop by remember { mutableStateOf<Float?>(null) }
    val latestOnBottomInsetChanged by rememberUpdatedState(onBottomInsetChanged)
    LaunchedEffect(rootHeight, rootTop, controlsTop) {
        val inset = controlsTop?.let { (rootHeight - (it - rootTop)).coerceAtLeast(0f) } ?: 0f
        latestOnBottomInsetChanged(inset)
    }
    Box(
        modifier.fillMaxSize().onGloballyPositioned { coords ->
            rootHeight = coords.size.height
            rootTop = coords.positionInRoot().y
        },
    ) {
        Box(Modifier.matchParentSize()) { video() }
        Column(Modifier.align(Alignment.TopCenter), horizontalAlignment = Alignment.CenterHorizontally) {
            toolbar()
            banner()
        }
        Box(
            Modifier.align(Alignment.BottomCenter)
                .windowInsetsPadding(imeInsets)
                .navigationBarsPadding()
                .displayCutoutPadding()
                .padding(8.dp)
                .onGloballyPositioned { coords ->
                    controlsTop = if (coords.size.height > 0) coords.positionInRoot().y else null
                },
        ) { controls() }
    }
}
