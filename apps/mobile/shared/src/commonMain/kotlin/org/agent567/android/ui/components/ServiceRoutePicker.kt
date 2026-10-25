package org.agent567.android.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import org.agent567.android.core.ServiceRoute
import org.agent567.android.core.ServiceRouteResult
import org.agent567.android.core.ServiceRouteCatalog
import org.agent567.android.ui.i18n.Str

@Composable
fun ServiceRouteEntry(serverUrl: String, onOpen: () -> Unit, routes: List<ServiceRoute> = ServiceRoute.entries) {
    Surface(onClick = onOpen, color = MaterialTheme.colorScheme.surface.copy(alpha = 0f), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(Str.serviceRouteTitle, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Text(ServiceRoute.fromServer(serverUrl, routes)?.let(Str::serviceRouteName) ?: runCatching { io.ktor.http.Url(serverUrl).host }.getOrDefault(Str.serviceRouteCustomName), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Icon(androidx.compose.material.icons.Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun ServiceRoutePickerDialog(
    serverUrl: String,
    pending: ServiceRoute?,
    results: Map<ServiceRoute, ServiceRouteResult>,
    changed: Boolean,
    catalog: ServiceRouteCatalog,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onAction: (ServiceRoute, Boolean) -> Unit,
    onClose: () -> Unit,
) {
    val current = ServiceRoute.fromServer(serverUrl, catalog.routes)
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(Str.serviceRouteTitle) },
        text = {
            Column(Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(Str.serviceRouteDiscovery, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (refreshing) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.dp)
                    TextButton(onClick = onRefresh, enabled = !refreshing) { Text(Str.serviceRouteRefresh) }
                }
                if (catalog.refreshFailed) Text(Str.serviceRouteCached, style = MaterialTheme.typography.bodySmall)
                if (current == null) Text(Str.serviceRouteCustomHint, style = MaterialTheme.typography.bodySmall)
                catalog.routes.forEach { route ->
                    Column {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Row(
                                Modifier.weight(1f).selectable(selected = current == route, enabled = current != null && pending == null, role = Role.RadioButton, onClick = { onAction(route, true) }).padding(vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                RadioButton(selected = current == route, onClick = null, enabled = current != null && pending == null)
                                Column(Modifier.padding(start = 8.dp)) {
                                    Text(Str.serviceRouteName(route), style = MaterialTheme.typography.bodyMedium)
                                    Text(route.origin.removePrefix("https://"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    route.description?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                }
                            }
                            TextButton(onClick = { onAction(route, false) }, enabled = pending == null) { Text(Str.serviceRouteProbe) }
                        }
                        results[route]?.let { result -> Text(if (result.ok) Str.serviceRouteReachable(result.elapsedMs ?: 0) else Str.serviceRouteError(result.error), style = MaterialTheme.typography.bodySmall, color = if (result.ok) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error) }
                    }
                }
                if (pending != null) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text(Str.serviceRouteChecking, style = MaterialTheme.typography.bodySmall)
                } else Text(if (changed) Str.serviceRouteChanged else Str.serviceRouteHint, style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text(if (pending != null) Str.serviceRouteCancel else Str.serviceRouteClose) } },
    )
}
