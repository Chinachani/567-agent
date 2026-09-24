package org.vetta.android.ui.me
import org.vetta.android.ui.chat.RotatingRefreshIcon

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import org.vetta.android.core.model.SubscriptionStatus
import org.vetta.android.core.model.User
import org.vetta.android.ui.components.PrimaryBlackButton
import org.vetta.android.ui.components.EmptyState
import org.vetta.android.ui.components.QuotaMeter
import org.vetta.android.ui.components.SectionHeader
import org.vetta.android.ui.components.VettaListGroup
import org.vetta.android.ui.components.VettaConfirmDialog
import org.vetta.android.ui.components.VettaChoiceDialog
import org.vetta.android.ui.components.VettaInfoDialog
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.theme.vettaExtra

fun formatUsd(usd: Double): String {
    val cents = (usd * 100.0 + 0.5).toLong()
    val intPart = cents / 100
    val fracPart = (cents % 100).toString().padStart(2, '0')
    return "$intPart.$fracPart"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MeScreen(
    user: User?,
    subscription: SubscriptionStatus?,
    activeGroup: String? = null,
    availableGroups: Map<String, org.vetta.android.core.api.ApiGroupInfoDto> = emptyMap(),
    onlineDeviceCount: Int,
    onSelectGroup: (String) -> Unit = {},
    onRefreshQuota: () -> Unit = {},
    catalogLoading: Boolean = false,
    onOpenPlan: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    onOpenDevices: () -> Unit = {},
    onOpenAbout: () -> Unit = {},
    onLogin: () -> Unit = {},
    onLogout: (clearLocal: Boolean) -> Unit = {},
    onTopupWithKey: (String, (Boolean, String) -> Unit) -> Unit = { _, _ -> },
    onCreatePayOrder: (Int, String, (String) -> Unit, (String) -> Unit) -> Unit = { _, _, _, _ -> },
) {
    var confirmLogout by remember { mutableStateOf(false) }
    var showGroupDialog by remember { mutableStateOf(false) }
    var showTopupDialog by remember { mutableStateOf(false) }
    val name = user?.nickname?.ifBlank { user.username } ?: Str.notLoggedIn
    val contact = user?.email ?: user?.phone ?: ""
    val usdFormatted = user?.let { formatUsd(it.quota.toDouble() / 500000.0) } ?: "0.00"

    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.me, style = MaterialTheme.typography.titleMedium) },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.vettaExtra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, top = 8.dp, end = 16.dp, bottom = 40.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BoxAvatar(name)
                Spacer(Modifier.width(14.dp))
                Column {
                    Text(name, style = MaterialTheme.typography.titleMedium)
                    if (contact.isNotBlank()) {
                        Text(
                            contact,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.vettaExtra.secondaryText,
                        )
                    }
                }
            }

            if (user != null) {
                Spacer(Modifier.height(16.dp))
                androidx.compose.material3.Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = androidx.compose.material3.CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
                    ),
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column {
                                Text("567 API 可用额度", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.vettaExtra.secondaryText)
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    "$$usdFormatted",
                                    style = MaterialTheme.typography.headlineMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold),
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                androidx.compose.material3.FilledTonalButton(
                                    onClick = { showTopupDialog = true },
                                    modifier = Modifier.height(36.dp),
                                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                                ) {
                                    Text("充值", style = MaterialTheme.typography.labelMedium)
                                }
                                Spacer(Modifier.width(6.dp))
                                IconButton(onClick = onRefreshQuota) {
                                    RotatingRefreshIcon(isRefreshing = catalogLoading, contentDescription = "刷新余额")
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        androidx.compose.material3.HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.4f))
                        Spacer(Modifier.height(12.dp))
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { showGroupDialog = true },
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text("当前接入分组", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.vettaExtra.secondaryText)
                                Spacer(Modifier.height(2.dp))
                                Text(
                                    activeGroup ?: "默认分组 (点击切换)",
                                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium),
                                )
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("切换分组", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                                Icon(
                                    Icons.AutoMirrored.Filled.KeyboardArrowRight,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(20.dp))
            SectionHeader(title = Str.accountAndDevices)
            VettaListGroup {
                ProfileRow(Icons.Default.Devices, Str.connectedDevices, "$onlineDeviceCount", onOpenDevices, showDivider = false)
            }

            Spacer(Modifier.height(16.dp))
            SectionHeader(title = Str.settings)
            VettaListGroup {
                ProfileRow(Icons.Default.Settings, Str.generalSettings, null, onOpenSettings, showDivider = false)
            }

            Spacer(Modifier.height(16.dp))
            SectionHeader(title = Str.aboutSection)
            VettaListGroup {
                ProfileRow(Icons.Default.Info, Str.aboutUs, Str.versionNumber.removePrefix("版本 "), onOpenAbout, showDivider = false)
            }

            Spacer(Modifier.height(24.dp))
            if (user == null) {
                PrimaryBlackButton(text = Str.getStarted, onClick = onLogin)
            } else {
                PrimaryBlackButton(text = Str.logout, onClick = { confirmLogout = true })
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (showTopupDialog) {
        TopupDialog(
            onDismiss = { showTopupDialog = false },
            onTopupWithKey = onTopupWithKey,
            onCreatePayOrder = onCreatePayOrder,
            onRefreshQuota = onRefreshQuota,
        )
    }

    if (showGroupDialog) {
        GroupSelectionDialog(
            activeGroup = activeGroup,
            availableGroups = availableGroups,
            onSelect = { group ->
                showGroupDialog = false
                onSelectGroup(group)
            },
            onDismiss = { showGroupDialog = false },
        )
    }

    if (confirmLogout) {
        VettaChoiceDialog(
            title = Str.logout,
            message = Str.logoutConfirm,
            primaryLabel = Str.confirmLogout,
            onPrimary = {
                confirmLogout = false
                onLogout(false)
            },
            secondaryLabel = Str.logoutAndClear,
            onSecondary = {
                confirmLogout = false
                onLogout(true)
            },
            onDismiss = { confirmLogout = false },
        )
    }
}

@Composable
private fun BoxAvatar(name: String) {
    val letter = name.firstOrNull()?.uppercaseChar()?.toString() ?: "V"
    Box(
        modifier =
            Modifier
                .size(56.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary),
        contentAlignment = Alignment.Center,
    ) {
        Text(letter, color = MaterialTheme.colorScheme.onPrimary, style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun ProfileRow(
    icon: ImageVector,
    title: String,
    value: String?,
    onClick: (() -> Unit)?,
    showDivider: Boolean = true,
    subtitle: String? = null,
) {
    val rowModifier =
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(vertical = 14.dp)
    Row(
        modifier = rowModifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurface)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (!subtitle.isNullOrBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.vettaExtra.secondaryText,
                )
            }
        }
        if (!value.isNullOrBlank()) {
            Text(value, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
            Spacer(Modifier.width(4.dp))
        }
        if (onClick != null) {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.vettaExtra.secondaryText,
            )
        }
    }
    if (showDivider) {
        androidx.compose.material3.HorizontalDivider(color = MaterialTheme.vettaExtra.border)
    }
}

private enum class AboutDocument {
    Licenses,
    Privacy,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanScreen(
    subscription: SubscriptionStatus?,
    loggedIn: Boolean,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onLogin: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.plan, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                actions = {
                    if (loggedIn) {
                        IconButton(onClick = onRefresh) {
                            Icon(Icons.Default.Refresh, contentDescription = Str.actionRetry)
                        }
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.vettaExtra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            if (!loggedIn) {
                EmptyState(
                    title = Str.loginToViewPlan,
                    actionLabel = Str.getStarted,
                    onAction = onLogin,
                    modifier = Modifier.fillMaxWidth(),
                )
                return@Column
            }
            VettaListGroup {
                Text(
                    when {
                        subscription == null -> Str.loading
                        !subscription.goEnabled -> Str.planDisabled
                        !subscription.active -> Str.planInactive
                        else -> Str.planActive
                    },
                    style = MaterialTheme.typography.titleMedium,
                )
                if (subscription?.tierName != null) {
                    Spacer(Modifier.height(6.dp))
                    Text(subscription.tierName, style = MaterialTheme.typography.bodyLarge)
                }
                if (!subscription?.description.isNullOrBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        subscription.description.orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.vettaExtra.secondaryText,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            subscription?.windows.orEmpty().forEach { w ->
                VettaListGroup(modifier = Modifier.padding(vertical = 10.dp)) {
                    QuotaMeter(
                        label =
                            when (w.kind) {
                                "5h" -> Str.window5h
                                "week" -> Str.windowWeek
                                "month" -> Str.windowMonth
                                else -> w.kind
                            },
                        limit = w.limit,
                        consumed = w.consumed,
                        resetAt = w.resetAt,
                    )
                }
            }
        }
    }

}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    themeMode: org.vetta.android.app.ThemeMode,
    autoResumeLastSession: Boolean,
    motionEnabled: Boolean,
    onThemeMode: (org.vetta.android.app.ThemeMode) -> Unit,
    onAutoResumeLastSession: (Boolean) -> Unit,
    onMotionEnabled: (Boolean) -> Unit,
    onClearLocalData: () -> Unit,
    onOpenAbout: () -> Unit,
    onBack: () -> Unit,
    confirmBeforeDelete: Boolean,
    onConfirmBeforeDelete: (Boolean) -> Unit,
) {
    var confirmClearLocalData by remember { mutableStateOf(false) }
    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.settings, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.vettaExtra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, top = 8.dp, end = 16.dp, bottom = 40.dp),
        ) {
            SectionHeader(title = Str.appearance)
            Text(
                Str.appearanceHint,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.vettaExtra.secondaryText,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
            )
            Spacer(Modifier.height(10.dp))
            ThemeModeSelector(themeMode = themeMode, onThemeMode = onThemeMode)

            Spacer(Modifier.height(28.dp))
            SectionHeader(title = Str.behavior)
            VettaListGroup {
                PreferenceSwitchRow(
                    title = Str.autoResume,
                    subtitle = Str.autoResumeHint,
                    checked = autoResumeLastSession,
                    onCheckedChange = onAutoResumeLastSession,
                    showDivider = true,
                )
                PreferenceSwitchRow(
                    title = Str.pageMotion,
                    subtitle = Str.pageMotionHint,
                    checked = motionEnabled,
                    onCheckedChange = onMotionEnabled,
                    showDivider = false,
                )
            }

            Spacer(Modifier.height(28.dp))
            SectionHeader(title = Str.dataSection)
            VettaListGroup {
                ProfileRow(
                    Icons.Default.DeleteSweep,
                    Str.clearLocalData,
                    null,
                    onClick = { confirmClearLocalData = true },
                    showDivider = true,
                    subtitle = Str.clearLocalDataHint,
                )
                PreferenceSwitchRow(
                    title = Str.confirmDeleteSession,
                    subtitle = Str.confirmDeleteSessionHint,
                    checked = confirmBeforeDelete,
                    onCheckedChange = onConfirmBeforeDelete,
                    showDivider = false,
                )
            }

            Spacer(Modifier.height(28.dp))
            SectionHeader(title = Str.aboutSection)
            VettaListGroup {
                ProfileRow(Icons.Default.Info, Str.aboutVetta, Str.versionNumber.removePrefix("版本 "), onOpenAbout, showDivider = false)
            }
        }
    }

    if (confirmClearLocalData) {
        VettaConfirmDialog(
            title = Str.clearLocalDataTitle,
            message = Str.clearLocalDataMessage,
            confirmLabel = Str.clearLocalDataAction,
            onConfirm = {
                confirmClearLocalData = false
                onClearLocalData()
            },
            onDismiss = { confirmClearLocalData = false },
        )
    }
}

@Composable
private fun ThemeModeSelector(
    themeMode: org.vetta.android.app.ThemeMode,
    onThemeMode: (org.vetta.android.app.ThemeMode) -> Unit,
) {
    val modes =
        listOf(
            org.vetta.android.app.ThemeMode.System to Str.themeSystem,
            org.vetta.android.app.ThemeMode.Light to Str.themeLight,
            org.vetta.android.app.ThemeMode.Dark to Str.themeDark,
        )
    androidx.compose.foundation.layout.Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp),
    ) {
        modes.forEach { (mode, label) ->
            val selected = themeMode == mode
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
                modifier =
                    Modifier
                        .weight(1f)
                        .clip(MaterialTheme.shapes.medium)
                        .background(if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.vettaExtra.chipBackground)
                        .clickable { onThemeMode(mode) }
                        .padding(vertical = 13.dp),
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun PreferenceSwitchRow(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    showDivider: Boolean,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .toggleable(
                    value = checked,
                    role = Role.Switch,
                    onValueChange = onCheckedChange,
                )
                .padding(vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Spacer(Modifier.height(2.dp))
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
        }
        androidx.compose.material3.Switch(checked = checked, onCheckedChange = null)
    }
    if (showDivider) {
        androidx.compose.material3.HorizontalDivider(color = MaterialTheme.vettaExtra.border)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(onBack: () -> Unit) {
    var openDocument by remember { mutableStateOf<AboutDocument?>(null) }
    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.aboutVetta, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.vettaExtra.pageBackground),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 24.dp, top = 36.dp, end = 24.dp, bottom = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BoxAvatar(Str.appName)
            Spacer(Modifier.height(16.dp))
            Text(Str.appName, style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Text(Str.versionNumber, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
            Spacer(Modifier.height(24.dp))
            Text(Str.aboutDescription, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.vettaExtra.secondaryText)
            Spacer(Modifier.height(28.dp))
            VettaListGroup {
                ProfileRow(
                    Icons.Default.Info,
                    Str.openSourceLicenses,
                    null,
                    onClick = { openDocument = AboutDocument.Licenses },
                    showDivider = true,
                )
                ProfileRow(
                    Icons.Default.Info,
                    Str.privacyPolicy,
                    null,
                    onClick = { openDocument = AboutDocument.Privacy },
                    showDivider = false,
                )
            }
        }
    }

    openDocument?.let { document ->
        val title = if (document == AboutDocument.Licenses) Str.openSourceLicenses else Str.privacyPolicy
        val body = if (document == AboutDocument.Licenses) Str.openSourceLicensesBody else Str.privacyPolicyBody
        VettaInfoDialog(
            title = title,
            message = body,
            onDismiss = { openDocument = null },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupSelectionDialog(
    activeGroup: String?,
    availableGroups: Map<String, org.vetta.android.core.api.ApiGroupInfoDto>,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
        ) {
            Text("选择 567 API 接入分组", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text("切换分组将自动接入对应渠道的模型和倍率", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
            Spacer(Modifier.height(16.dp))

            if (availableGroups.isEmpty()) {
                Text("暂无可用分组，请检查网络或重新登录", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.vettaExtra.secondaryText)
            } else {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    availableGroups.forEach { (name, info) ->
                        val isSelected = name == activeGroup
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onSelect(name) }
                                .padding(vertical = 12.dp, horizontal = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(name, style = MaterialTheme.typography.bodyMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium))
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        "${info.ratio}x 倍率",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                }
                                if (info.desc.isNotBlank()) {
                                    Spacer(Modifier.height(2.dp))
                                    Text(info.desc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
                                }
                            }
                            if (isSelected) {
                                Icon(Icons.Default.Check, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            }
                        }
                        androidx.compose.material3.HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TopupDialog(
    onDismiss: () -> Unit,
    onTopupWithKey: (String, (Boolean, String) -> Unit) -> Unit,
    onCreatePayOrder: (Int, String, (String) -> Unit, (String) -> Unit) -> Unit,
    onRefreshQuota: () -> Unit,
) {
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    var activeTab by remember { mutableStateOf(0) } // 0: 在线充值, 1: 卡密兑换
    var selectedAmount by remember { mutableStateOf(20) }
    var customAmountText by remember { mutableStateOf("") }
    var payMethod by remember { mutableStateOf("alipay") }
    var cdkeyText by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var isError by remember { mutableStateOf(false) }
    var payingNotice by remember { mutableStateOf(false) }

    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = { androidx.compose.material3.BottomSheetDefaults.DragHandle() },
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("账户额度充值", style = MaterialTheme.typography.titleLarge.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.DeleteSweep, contentDescription = "关闭", modifier = Modifier.size(20.dp))
                }
            }
            Spacer(Modifier.height(12.dp))

            // Tab 切换
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f), androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                    .padding(4.dp),
            ) {
                listOf("在线充值", "卡密兑换").forEachIndexed { idx, title ->
                    val isSel = activeTab == idx
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .background(
                                if (isSel) MaterialTheme.colorScheme.surface else androidx.compose.ui.graphics.Color.Transparent,
                                androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
                            )
                            .clickable { activeTab = idx; message = null }
                            .padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            title,
                            style = MaterialTheme.typography.labelMedium.copy(fontWeight = if (isSel) androidx.compose.ui.text.font.FontWeight.Bold else androidx.compose.ui.text.font.FontWeight.Normal),
                            color = if (isSel) MaterialTheme.colorScheme.primary else MaterialTheme.vettaExtra.secondaryText,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            if (message != null) {
                Text(
                    text = message!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }

            if (activeTab == 0) {
                // 在线充值 (易支付)
                Text("选择支付方式", style = MaterialTheme.typography.labelMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
                Spacer(Modifier.height(8.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("alipay" to "支付宝", "wxpay" to "微信支付").forEach { (method, label) ->
                        val isSel = payMethod == method
                        androidx.compose.material3.OutlinedButton(
                            onClick = { payMethod = method },
                            modifier = Modifier.weight(1f),
                            shape = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
                            border = androidx.compose.foundation.BorderStroke(
                                1.5.dp,
                                if (isSel) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                            ),
                        ) {
                            Text(label, color = if (isSel) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))
                Text("充值金额 (1元 = $1)", style = MaterialTheme.typography.labelMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
                Spacer(Modifier.height(8.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(10, 20, 50, 100).forEach { amt ->
                        val isSel = selectedAmount == amt && customAmountText.isBlank()
                        androidx.compose.material3.OutlinedButton(
                            onClick = { selectedAmount = amt; customAmountText = "" },
                            modifier = Modifier.weight(1f),
                            shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
                            border = androidx.compose.foundation.BorderStroke(
                                1.dp,
                                if (isSel) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant,
                            ),
                        ) {
                            Text("¥$amt", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                org.vetta.android.ui.components.VettaTextField(
                    value = customAmountText,
                    onValueChange = { customAmountText = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("自定义金额 (≥1元整数)") },
                )

                if (payingNotice) {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "已调起外部支付收银台，支付成功后请刷新余额查看最新到账额度",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }

                Spacer(Modifier.height(20.dp))
                PrimaryBlackButton(
                    text = if (loading) "正在创建订单..." else "前往支付",
                    onClick = {
                        val finalAmt = customAmountText.toIntOrNull() ?: selectedAmount
                        if (finalAmt < 1) {
                            message = "金额不能少于 1 元"
                            isError = true
                            return@PrimaryBlackButton
                        }
                        loading = true
                        message = null
                        onCreatePayOrder(finalAmt, payMethod, { payUrl ->
                            loading = false
                            payingNotice = true
                            runCatching { uriHandler.openUri(payUrl) }
                        }, { err ->
                            loading = false
                            message = err
                            isError = true
                        })
                    },
                    enabled = !loading,
                )
            } else {
                // 卡密兑换
                Text("输入兑换码 / 卡密", style = MaterialTheme.typography.labelMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
                Spacer(Modifier.height(8.dp))
                org.vetta.android.ui.components.VettaTextField(
                    value = cdkeyText,
                    onValueChange = { cdkeyText = it; message = null },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("卡密 (CDKEY)") },
                )
                Spacer(Modifier.height(20.dp))
                PrimaryBlackButton(
                    text = if (loading) "正在兑换..." else "立即兑换",
                    onClick = {
                        if (cdkeyText.isBlank()) {
                            message = "请输入卡密"
                            isError = true
                            return@PrimaryBlackButton
                        }
                        loading = true
                        message = null
                        onTopupWithKey(cdkeyText.trim()) { ok, msg ->
                            loading = false
                            isError = !ok
                            message = msg
                            if (ok) {
                                cdkeyText = ""
                                onRefreshQuota()
                            }
                        }
                    },
                    enabled = !loading && cdkeyText.isNotBlank(),
                )
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}
