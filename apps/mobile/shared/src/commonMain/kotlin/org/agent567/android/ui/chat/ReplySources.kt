package org.agent567.android.ui.chat

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.style.TextOverflow
import org.agent567.android.core.model.ChatSource
import org.agent567.android.ui.i18n.Str

@Composable
internal fun ReplySources(sources: List<ChatSource>, onNotice: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val opener = LocalUriHandler.current
    Column {
        TextButton(onClick = { expanded = !expanded }) { Text(Str.replySourceCount(sources.size)) }
        if (expanded) sources.forEachIndexed { index, source ->
            TextButton(onClick = {
                try { opener.openUri(source.url) } catch (_: RuntimeException) { onNotice(Str.sourceOpenFailed) }
            }) {
                Column(Modifier.fillMaxWidth()) {
                    Text("${index + 1}. ${source.title ?: source.url}", maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (source.title != null) Text(source.url, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
