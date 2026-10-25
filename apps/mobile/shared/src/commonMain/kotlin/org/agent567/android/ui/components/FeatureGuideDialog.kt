package org.agent567.android.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

@Composable
internal fun FeatureGuideDialog(onDismiss: () -> Unit) {
    var expanded by rememberSaveable { mutableStateOf(0) }
    ScrollableDetailDialog(title = Str.featureGuideTitle, onDismiss = onDismiss) {
        Text(Str.featureGuideIntro, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.agent567Extra.secondaryText)
        Str.featureGuideTopics.forEachIndexed { index, (title, steps) ->
            val open = expanded == index
            Agent567Card(contentPadding = PaddingValues(0.dp)) {
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 64.dp)
                        .semantics { stateDescription = if (open) Str.collapse else Str.expand }
                        .clickable(role = Role.Button) { expanded = if (open) -1 else index }
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text((index + 1).toString().padStart(2, '0'), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.agent567Extra.secondaryText)
                    Text(title, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                    Icon(if (open) Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown, contentDescription = null)
                }
                if (open) {
                    HorizontalDivider(color = MaterialTheme.agent567Extra.border)
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        steps.lines().forEachIndexed { step, text ->
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text((step + 1).toString(), style = MaterialTheme.typography.labelLarge, color = MaterialTheme.agent567Extra.secondaryText)
                                Text(text.substringAfter(". ", text), modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
            }
        }
    }
}
