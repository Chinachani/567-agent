package org.agent567.android.ui.updates

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.chat.MarkdownContent
import org.agent567.android.ui.chat.normalizeReleaseNotesMarkdown
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

/** Scrollable Markdown body for app update dialogs, falling back to plain guidance when empty. */
@Composable
fun ReleaseNotesBody(
    releaseNotes: String,
    modifier: Modifier = Modifier,
    fallbackText: String = Str.updateHint,
    errorText: String? = null,
) {
    val normalized = remember(releaseNotes) { normalizeReleaseNotesMarkdown(releaseNotes) }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .heightIn(max = 360.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (normalized.isNotEmpty()) {
            MarkdownContent(source = normalized, compact = true)
        } else {
            Text(
                text = fallbackText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.agent567Extra.secondaryText,
            )
        }
        if (!errorText.isNullOrBlank()) {
            Text(
                text = errorText,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}
