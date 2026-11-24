package org.agent567.android.ui.chat

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.i18n.Str

@Composable
internal fun ImageModelChoices(group: String, suggested: List<String>, catalog: List<String>, selected: String?, onSelect: (String) -> Unit) {
    var query by rememberSaveable(group) { mutableStateOf("") }
    // A saved manual choice remains visible, but a new user must explicitly open the compatibility list.
    var showAll by rememberSaveable(group) { mutableStateOf(selected != null && selected in catalog && selected !in suggested) }
    val matches = remember(query, showAll, suggested, catalog) {
        (if (showAll) catalog else suggested).distinct().filter { it.contains(query.trim(), ignoreCase = true) }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(value = query, onValueChange = { query = it }, singleLine = true,
            label = { Text(Str.searchModelPlaceholder) }, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = !showAll, onClick = { showAll = false }, label = { Text(Str.imageGenModelsTab) })
            FilterChip(selected = showAll, onClick = { showAll = true }, label = { Text(Str.allModelsTab) })
        }
        if (showAll) Text(Str.compatibleModelNotice, style = MaterialTheme.typography.bodySmall)
        if (matches.isEmpty()) Text(when {
            query.isNotBlank() -> "没有匹配的模型，请更换关键词。"
            !showAll && catalog.isNotEmpty() -> "没有识别到可生成图片的模型。已知分组内某个模型支持画图时，可手动查看全部模型。"
            else -> "该分组暂无可用模型。"
        }, style = MaterialTheme.typography.bodyMedium)
        else LazyColumn(Modifier.fillMaxWidth().heightIn(max = 300.dp).selectableGroup()) {
            items(matches, key = { it }) { id ->
                Row(modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).selectable(selected = id == selected, role = Role.RadioButton, onClick = { onSelect(id) }).padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(selected = id == selected, onClick = null)
                    Spacer(Modifier.width(10.dp))
                    Text(id, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}
