package org.agent567.android.ui.remote

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
expect fun PairingScannerButton(
    onScanned: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
)
