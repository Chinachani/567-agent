package org.agent567.android.ui.chat

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
internal expect fun DraftDictationButton(
    onStart: () -> Unit,
    onResult: (String) -> Unit,
    onNotice: (String) -> Unit,
    onBusyChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
)
