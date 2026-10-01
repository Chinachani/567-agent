package org.vetta.android.ui.me

import androidx.compose.runtime.Composable

data class MigrationBackupFileActions(
    val save: (ByteArray) -> Unit,
    val open: () -> Unit,
)

@Composable
expect fun rememberMigrationBackupFileActions(
    onOpened: (ByteArray?) -> Unit,
    onSaved: (Boolean) -> Unit,
): MigrationBackupFileActions
