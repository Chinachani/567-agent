package org.agent567.android.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.agent567.android.core.api.ApiGroupInfoDto
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

/** Empty-string group key is valid on 567 API and represents the default group. */
internal fun groupDisplayName(key: String): String = key.ifEmpty { Str.mobileDefaultGroup }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupWizardSheet(
    loggedIn: Boolean,
    availableGroups: Map<String, ApiGroupInfoDto>,
    activeChatGroup: String?,
    activeImageGroup: String?,
    imageGenEnabled: Boolean,
    catalogLoading: Boolean,
    directoryUnavailable: Boolean,
    onRetryCatalog: () -> Unit,
    onSignIn: () -> Unit,
    onApply: (chatGroup: String?, imageGroup: String?, enableImageGen: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var userEdited by remember { mutableStateOf(false) }
    var chatGroup by remember { mutableStateOf(activeChatGroup) }
    var imageGroup by remember { mutableStateOf(activeImageGroup) }
    var enableImageGen by remember { mutableStateOf(imageGenEnabled) }
    var sameImageAsChat by remember {
        mutableStateOf(activeChatGroup != null && activeImageGroup == activeChatGroup)
    }

    LaunchedEffect(activeChatGroup, activeImageGroup, imageGenEnabled) {
        if (!userEdited) {
            chatGroup = activeChatGroup
            imageGroup = activeImageGroup
            enableImageGen = imageGenEnabled
            sameImageAsChat = activeChatGroup != null && activeImageGroup == activeChatGroup
        }
    }

    val resolvedImageGroup =
        when {
            !enableImageGen -> null
            sameImageAsChat -> chatGroup
            else -> imageGroup
        }
    val canConfirm =
        loggedIn && (chatGroup == null || chatGroup == activeChatGroup || chatGroup in availableGroups) &&
            (resolvedImageGroup == null || resolvedImageGroup == activeImageGroup || resolvedImageGroup in availableGroups) &&
            (chatGroup != null || resolvedImageGroup != null || enableImageGen != imageGenEnabled)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp)
                .padding(bottom = 24.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text(Str.groupWizardTitle, style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        Str.groupWizardSubtitle,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.agent567Extra.secondaryText,
                    )
                }
                if (loggedIn) {
                    IconButton(
                        onClick = onRetryCatalog,
                        enabled = !catalogLoading,
                        modifier = Modifier.size(48.dp),
                    ) {
                        if (catalogLoading) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Default.Refresh, contentDescription = Str.groupWizardRetry)
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            if (!loggedIn) {
                Agent567Card(contentPadding = PaddingValues(16.dp)) {
                    Text(Str.notLoggedIn, style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "登录后可以选择这个账号的对话和画图分组。也可以先浏览，或扫码连接电脑。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.agent567Extra.secondaryText,
                    )
                }
                Spacer(Modifier.height(16.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    SecondaryOutlineButton(
                        text = Str.groupWizardChooseLater,
                        onClick = onDismiss,
                        modifier = Modifier.weight(1f),
                    )
                    PrimaryBlackButton(
                        text = "登录账号",
                        onClick = {
                            onDismiss()
                            onSignIn()
                        },
                        modifier = Modifier.weight(1f),
                    )
                }
            } else {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (catalogLoading && availableGroups.isEmpty()) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(10.dp))
                        Text(
                            "正在加载可用分组…",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.agent567Extra.secondaryText,
                        )
                    }
                } else if (directoryUnavailable && availableGroups.isNotEmpty()) {
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.agent567Extra.amberContainer,
                        border = BorderStroke(1.dp, MaterialTheme.agent567Extra.amberAccent.copy(alpha = 0.35f)),
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                Str.groupWizardUseCache,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurface,
                                modifier = Modifier.weight(1f),
                            )
                            TextButton(
                                onClick = onRetryCatalog,
                                enabled = !catalogLoading,
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) {
                                Text(Str.groupWizardRetry)
                            }
                        }
                    }
                } else if (directoryUnavailable && availableGroups.isEmpty()) {
                    Agent567Card(contentPadding = PaddingValues(16.dp)) {
                        Text(
                            "暂无法获取在线分组目录",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "请检查网络或服务线路后重试，也可以先跳过稍后再选。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.agent567Extra.secondaryText,
                        )
                        Spacer(Modifier.height(10.dp))
                        TextButton(
                            onClick = onRetryCatalog,
                            enabled = !catalogLoading,
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) {
                            Text(Str.groupWizardRetry)
                        }
                    }
                } else if (!catalogLoading && availableGroups.isEmpty()) {
                    Agent567Card(contentPadding = PaddingValues(16.dp)) {
                        Text("当前账号暂无可用分组", style = MaterialTheme.typography.titleSmall)
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "请稍后重试拉取目录，或先返回工作空间。",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.agent567Extra.secondaryText,
                        )
                        Spacer(Modifier.height(10.dp))
                        TextButton(
                            onClick = onRetryCatalog,
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) {
                            Text(Str.groupWizardRetry)
                        }
                    }
                }

                if (availableGroups.isNotEmpty()) {
                    WizardSectionHeader(
                        title = Str.groupWizardChatSection,
                        summary = chatGroup?.let(::groupDisplayName) ?: "未选择",
                        highlighted = chatGroup != null,
                    )
                    GroupOptionList(
                        groups = availableGroups,
                        selectedGroup = chatGroup,
                        onSelect = { selected ->
                            userEdited = true
                            chatGroup = selected
                        },
                    )

                    WizardSectionHeader(
                        title = Str.groupWizardImageSection,
                        summary =
                            if (!enableImageGen) Str.mobileDrawingOff
                            else resolvedImageGroup?.let(::groupDisplayName) ?: "未选择",
                        highlighted = enableImageGen && resolvedImageGroup != null,
                    )

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .border(
                                1.dp,
                                MaterialTheme.agent567Extra.border.copy(alpha = 0.7f),
                                RoundedCornerShape(12.dp),
                            )
                            .toggleable(
                                value = enableImageGen,
                                role = Role.Switch,
                                onValueChange = { checked ->
                                    userEdited = true
                                    enableImageGen = checked
                                },
                            )
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text("启用智能画图", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
                            Text(
                                if (enableImageGen) "可复用对话分组或单独指定画图分组" else Str.mobileDrawingOff,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.agent567Extra.secondaryText,
                            )
                        }
                        Spacer(Modifier.width(8.dp))
                        Switch(checked = enableImageGen, onCheckedChange = null)
                    }

                    if (enableImageGen) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            WizardChoiceRow(
                                title = Str.groupWizardSameAsChat,
                                subtitle = chatGroup?.let(::groupDisplayName) ?: "跟随上方所选对话分组",
                                selected = sameImageAsChat,
                                onClick = {
                                    userEdited = true
                                    sameImageAsChat = true
                                },
                            )
                            WizardChoiceRow(
                                title = Str.groupWizardCustomImageGroup,
                                subtitle = imageGroup?.let(::groupDisplayName) ?: "从下方选择画图专用分组",
                                selected = !sameImageAsChat,
                                onClick = {
                                    userEdited = true
                                    sameImageAsChat = false
                                },
                            )
                        }
                        if (!sameImageAsChat) {
                            GroupOptionList(
                                groups = availableGroups,
                                selectedGroup = imageGroup,
                                onSelect = { selected ->
                                    userEdited = true
                                    imageGroup = selected
                                },
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                SecondaryOutlineButton(
                    text = Str.groupWizardChooseLater,
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f),
                )
                PrimaryBlackButton(
                    text = Str.groupWizardConfirm,
                    onClick = { onApply(chatGroup, resolvedImageGroup, enableImageGen) },
                    enabled = canConfirm,
                    modifier = Modifier.weight(1f),
                )
            }
            }
        }
    }
}

@Composable
private fun WizardSectionHeader(
    title: String,
    summary: String,
    highlighted: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
        if (highlighted) {
            Agent567AmberBadge(summary)
        } else {
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = MaterialTheme.agent567Extra.chipBackground,
            ) {
                Text(
                    summary,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.agent567Extra.secondaryText,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun GroupOptionList(
    groups: Map<String, ApiGroupInfoDto>,
    selectedGroup: String?,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        groups.entries.forEach { (key, info) ->
            val isSelected = selectedGroup != null && key == selectedGroup
            WizardChoiceRow(
                title = groupDisplayName(key),
                subtitle = info.desc.ifBlank { null },
                badge = "${info.ratio}x 倍率",
                selected = isSelected,
                onClick = { onSelect(key) },
            )
        }
    }
}

@Composable
private fun WizardChoiceRow(
    title: String,
    subtitle: String? = null,
    badge: String? = null,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val shape = RoundedCornerShape(12.dp)
    val bg =
        if (selected) MaterialTheme.agent567Extra.amberContainer
        else MaterialTheme.colorScheme.surface
    val borderColor =
        if (selected) MaterialTheme.agent567Extra.amberAccent.copy(alpha = 0.55f)
        else MaterialTheme.agent567Extra.border.copy(alpha = 0.7f)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .clip(shape)
            .background(bg)
            .border(1.dp, borderColor, shape)
            .selectable(
                selected = selected,
                role = Role.RadioButton,
                onClick = onClick,
            )
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null)
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    title,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (!badge.isNullOrBlank()) {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        badge,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (selected) MaterialTheme.agent567Extra.amberAccent else MaterialTheme.agent567Extra.secondaryText,
                    )
                }
            }
            if (!subtitle.isNullOrBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.agent567Extra.secondaryText,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (selected) {
            Spacer(Modifier.width(8.dp))
            Icon(
                Icons.Default.Check,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
                tint = MaterialTheme.agent567Extra.amberAccent,
            )
        }
    }
}
