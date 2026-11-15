package org.agent567.android.ui.remote

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Only the controls avoid the keyboard. Video size and pointer coordinates stay fixed. */
@Composable
internal fun RemoteFullscreenLayout(
    video: @Composable () -> Unit,
    toolbar: @Composable () -> Unit,
    controls: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    imeInsets: WindowInsets = WindowInsets.ime,
) {
    Box(modifier.fillMaxSize()) {
        Box(Modifier.matchParentSize()) { video() }
        Box(Modifier.align(Alignment.TopCenter)) { toolbar() }
        Box(
            Modifier.align(Alignment.BottomCenter)
                .windowInsetsPadding(imeInsets)
                .navigationBarsPadding()
                .displayCutoutPadding()
                .padding(8.dp),
        ) { controls() }
    }
}
