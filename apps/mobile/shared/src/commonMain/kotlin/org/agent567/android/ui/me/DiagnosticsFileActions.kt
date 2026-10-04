package org.agent567.android.ui.me

import androidx.compose.runtime.Composable

data class DiagnosticsFileActions(
    val export: () -> Unit,
)

@Composable
expect fun rememberDiagnosticsFileActions(
    onSaved: (Boolean?) -> Unit,
): DiagnosticsFileActions
