package org.agent567.android.ui.remote

import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.unit.dp

@Composable
internal fun RemoteFullscreenLayout(
    video: @Composable () -> Unit,
    toolbar: @Composable (Modifier) -> Unit,
    controls: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    keyboardOpen: Boolean = false,
    draftOpen: Boolean = false,
    onDraftOcclusion: (Float) -> Unit = {},
    banner: @Composable () -> Unit = {},
    mouse: @Composable (Modifier) -> Unit = {},
) {
    val toolbarState = rememberSaveableStateHolder()
    var safeHeight by remember { mutableIntStateOf(0) }
    var rootBottom by remember { mutableFloatStateOf(0f) }
    Box(modifier.fillMaxSize().onGloballyPositioned { rootBottom = it.positionInRoot().y + it.size.height }) {
        Box(Modifier.matchParentSize()) { video() }
        Box(Modifier.matchParentSize().displayCutoutPadding().navigationBarsPadding().padding(horizontal = 6.dp, vertical = 4.dp)
            .onSizeChanged { safeHeight = it.height }) {
            Box(Modifier.align(Alignment.TopCenter)) { banner() }
            if (draftOpen) Box(Modifier.align(Alignment.BottomCenter).imePadding().onGloballyPositioned {
                onDraftOcclusion((rootBottom - it.positionInRoot().y).coerceAtLeast(0f))
            }) { controls() }
            else if (keyboardOpen) Box(Modifier.align(Alignment.TopStart).imePadding()) { controls() }
            else {
                toolbarState.SaveableStateProvider("edge-controls") {
                    EdgeDock(-1f, safeHeight, mouse)
                    EdgeDock(1f, safeHeight, toolbar)
                }
            }
        }
    }
}

@Composable
private fun BoxScope.EdgeDock(edge: Float, safeHeight: Int, content: @Composable (Modifier) -> Unit) {
    var dockY by rememberSaveable { mutableFloatStateOf(0f) }
    var height by remember { mutableIntStateOf(0) }
    Box(Modifier.align(BiasAlignment(edge, dockY)).onSizeChanged { height = it.height }) {
        content(Modifier.draggable(rememberDraggableState { delta ->
            val travel = safeHeight - height
            if (travel > 0) dockY = (dockY + 2f * delta / travel).coerceIn(-1f, 1f)
        }, Orientation.Vertical))
    }
}
