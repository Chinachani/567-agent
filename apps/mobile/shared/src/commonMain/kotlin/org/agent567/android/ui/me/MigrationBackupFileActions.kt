package org.agent567.android.ui.me

import androidx.compose.runtime.Composable

data class MigrationBackupFileActions(
    val save: (ByteArray) -> Unit,
    val open: () -> Unit,
)

enum class MigrationBackupFileError { TooLarge, Access }

@Composable
expect fun rememberMigrationBackupFileActions(
    onOpened: (ByteArray?, MigrationBackupFileError?) -> Unit,
    onSaved: (Boolean, MigrationBackupFileError?) -> Unit,
): MigrationBackupFileActions
