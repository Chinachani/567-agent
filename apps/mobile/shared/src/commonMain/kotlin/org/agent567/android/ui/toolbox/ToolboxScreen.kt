package org.agent567.android.ui.toolbox

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.agent567.android.domain.conversation.RemoteToolboxAbility
import org.agent567.android.ui.theme.agent567Extra

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ToolboxScreen(
    title: String,
    abilities: List<RemoteToolboxAbility>,
    query: String,
    loading: Boolean,
    error: String?,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onInstall: (RemoteToolboxAbility) -> Unit,
    onConnectDesktop: () -> Unit,
    onBack: () -> Unit,
    deviceName: String?,
) {
    var pendingInstall by remember { mutableStateOf<RemoteToolboxAbility?>(null) }
    val filtered = remember(abilities, query) {
        val needle = query.trim().lowercase()
        if (needle.isEmpty()) abilities else abilities.filter {
            listOf(it.name, it.slug, it.description, it.author, it.category, it.tags.joinToString(" "))
                .any { field -> field.lowercase().contains(needle) }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                },
                actions = {
                    IconButton(onClick = onRefresh, enabled = !loading) {
                        if (loading) CircularProgressIndicator()
                        else Icon(Icons.Default.Refresh, contentDescription = "刷新工具箱")
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp)) {
            Text(
                "${deviceName?.let { "$it · " }.orEmpty()}能力来自电脑端应用内市场；技能、场景和插件将在这台电脑运行。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.agent567Extra.secondaryText,
            )
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                label = { Text("搜索能力") },
            )
            if (error != null) {
                Spacer(Modifier.height(10.dp))
                Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                if (error.contains("连接") || error.contains("电脑")) {
                    TextButton(onClick = onConnectDesktop) { Text("连接电脑") }
                }
            }
            when {
                loading && abilities.isEmpty() -> Column(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) { CircularProgressIndicator() }
                abilities.isEmpty() -> Column(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(if (error == null) "暂无能力目录" else "暂时无法读取工具箱", style = MaterialTheme.typography.titleMedium)
                    Text("连接电脑后可浏览并安装桌面能力。", color = MaterialTheme.agent567Extra.secondaryText)
                    TextButton(onClick = onRefresh) { Text("重试") }
                }
                filtered.isEmpty() -> Column(
                    Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) { Text("没有匹配的能力", color = MaterialTheme.agent567Extra.secondaryText) }
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 12.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(filtered, key = { "${it.type}:${it.slug}" }) { ability ->
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)),
                        ) {
                            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Column(Modifier.weight(1f)) {
                                        Text(ability.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        Text("${typeLabel(ability.type)} · ${ability.version}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.agent567Extra.secondaryText)
                                    }
                                    Text(
                                        when {
                                            ability.installed -> "已安装"
                                            ability.type == "mcp" -> "桌面配置"
                                            ability.installable -> "可安装"
                                            else -> "仅浏览"
                                        },
                                        style = MaterialTheme.typography.labelSmall,
                                        color = if (ability.installed) MaterialTheme.colorScheme.primary else MaterialTheme.agent567Extra.secondaryText,
                                    )
                                }
                                Text(ability.description.ifBlank { "暂无简介" }, style = MaterialTheme.typography.bodySmall, maxLines = 4, overflow = TextOverflow.Ellipsis)
                                val metadata = listOfNotNull(
                                    ability.category.takeIf(String::isNotBlank),
                                    ability.author.takeIf(String::isNotBlank)?.let { "作者：$it" },
                                    ability.tags.take(4).joinToString(" · ").takeIf(String::isNotBlank),
                                ).joinToString("  ·  ")
                                if (metadata.isNotBlank()) Text(metadata, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.agent567Extra.secondaryText, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                if (!ability.installed && ability.installable) {
                                    Button(onClick = { pendingInstall = ability }, enabled = !loading) { Text("安装到电脑") }
                                } else if (ability.type == "mcp") {
                                    Text("MCP 需要在桌面端完成连接参数和密钥配置。", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.agent567Extra.secondaryText)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    pendingInstall?.let { ability ->
        AlertDialog(
            onDismissRequest = { pendingInstall = null },
            title = { Text("安装到电脑？") },
            text = { Text("将安装“${ability.name}”到已连接电脑的用户环境中。") },
            confirmButton = {
                TextButton(onClick = { pendingInstall = null; onInstall(ability) }) { Text("安装") }
            },
            dismissButton = { TextButton(onClick = { pendingInstall = null }) { Text("取消") } },
        )
    }
}

private fun typeLabel(type: String): String = when (type) {
    "skill" -> "技能"
    "scene" -> "场景"
    "plugin" -> "插件"
    "mcp" -> "MCP 服务"
    "bundle" -> "组合包"
    else -> "能力"
}
