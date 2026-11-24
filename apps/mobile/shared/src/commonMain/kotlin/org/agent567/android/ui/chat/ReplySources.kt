package org.agent567.android.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.agent567.android.core.model.ChatSource
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

@Composable
internal fun ReplySources(sources: List<ChatSource>, onNotice: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val opener = LocalUriHandler.current
    Column(Modifier.padding(top = 2.dp)) {
        TextButton(onClick = { expanded = !expanded }) {
            Text(Str.replySourceCount(sources.size), color = MaterialTheme.agent567Extra.amberAccent)
        }
        if (expanded) {
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).padding(start = 8.dp, bottom = 4.dp)) {
                Box(
                    Modifier
                        .width(2.dp)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(1.dp))
                        .background(MaterialTheme.agent567Extra.amberAccent.copy(alpha = 0.45f)),
                )
                Column(
                    Modifier.weight(1f).padding(start = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    sources.forEachIndexed { index, source ->
                        Column(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .heightIn(min = 48.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable(role = Role.Button) {
                                        try { opener.openUri(source.url) } catch (_: RuntimeException) { onNotice(Str.sourceOpenFailed) }
                                    }
                                    .padding(horizontal = 6.dp, vertical = 6.dp),
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text(
                                "${index + 1}. ${source.title ?: source.url}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (source.title != null) {
                                Text(
                                    source.url,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.agent567Extra.secondaryText,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
