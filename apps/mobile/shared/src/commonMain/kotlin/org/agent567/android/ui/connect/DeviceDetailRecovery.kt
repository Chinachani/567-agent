package org.agent567.android.ui.connect

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str

/** Keep the destination stable while restored pairings repopulate the device list. */
@Composable
internal fun DeviceDetailRecovery(connecting: Boolean, onBack: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (connecting) CircularProgressIndicator()
            Text(if (connecting) Str.loading else Str.desktopUnavailable, style = MaterialTheme.typography.titleMedium)
            Text(Str.desktopUnavailableHint, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = onBack) { Text(Str.back) }
        }
    }
}
