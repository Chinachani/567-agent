package org.agent567.android.ui.me

import org.agent567.android.resources.brand_icon
import org.agent567.android.AppVersion
import org.agent567.android.ui.chat.RotatingRefreshIcon

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Devices
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import kotlinx.coroutines.delay
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.saveable.rememberSaveable
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import org.agent567.android.core.model.SubscriptionStatus
import org.agent567.android.core.model.User
import org.agent567.android.app.normalizeGitHubDownloadPrefix
import org.agent567.android.data.session.MIGRATION_BACKUP_LIMIT_OPTIONS_MB
import org.agent567.android.ui.components.MobileIconTile
import androidx.compose.ui.text.style.TextOverflow
import org.agent567.android.ui.components.PrimaryBlackButton
import org.agent567.android.ui.components.EmptyState
import org.agent567.android.ui.components.QuotaMeter
import org.agent567.android.ui.components.SectionHeader
import org.agent567.android.ui.components.Agent567ListGroup
import org.agent567.android.ui.components.Agent567Card
import org.agent567.android.ui.components.Agent567ConfirmDialog
import org.agent567.android.ui.components.Agent567ChoiceDialog
import org.agent567.android.ui.components.Agent567InfoDialog
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

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
    themeMode: org.agent567.android.app.ThemeMode,
    activeGroup: String? = null,
    availableGroups: Map<String, org.agent567.android.core.api.ApiGroupInfoDto> = emptyMap(),
    onlineDeviceCount: Int,
    onSelectGroup: (String) -> Unit = {},
    onRefreshQuota: () -> Unit = {},
    catalogLoading: Boolean = false,
    quotaRefreshing: Boolean = false,
    accountVerifying: Boolean = false,
    accountVerificationMessage: String? = null,
    onOpenPlan: () -> Unit = {},
    onOpenSettings: () -> Unit = {},
    onOpenDataSettings: () -> Unit = {},
    onThemeMode: (org.agent567.android.app.ThemeMode) -> Unit = {},
    onOpenDevices: () -> Unit = {},
    onOpenAbout: () -> Unit = {},
    onOpenAccount: () -> Unit = {},
    onTopupWithKey: (String, (Boolean, String) -> Unit) -> Unit = { _, _ -> },
    onCreatePayOrder: (Int, String, (org.agent567.android.core.PayOrderResult, Double) -> Unit, (String) -> Unit) -> Unit = { _, _, _, _ -> },
    serverUrl: String = "",
    onOpenServiceRoute: () -> Unit = {},
    serviceRoutes: List<org.agent567.android.core.ServiceRoute> = org.agent567.android.core.ServiceRoute.entries,
    hasUpdate: Boolean = false,
) {
    var showFeatureGuide by remember { mutableStateOf(false) }
    var showGroupDialog by remember { mutableStateOf(false) }
    var showTopupDialog by remember { mutableStateOf(false) }
    val name = user?.nickname?.ifBlank { user.username } ?: Str.notLoggedIn
    val contact = user?.email ?: user?.phone ?: ""
    val usdFormatted = user?.let { formatUsd(it.quota.toDouble() / 500000.0) } ?: "0.00"

    Scaffold(
        containerColor = MaterialTheme.agent567Extra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.me, style = MaterialTheme.typography.titleLarge) },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.agent567Extra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 16.dp, top = 4.dp, end = 16.dp, bottom = 24.dp),
        ) {
            Row(Modifier.fillMaxWidth().clip(MaterialTheme.shapes.large).background(MaterialTheme.colorScheme.surface).clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onOpenAccount).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                BoxAvatar(user?.username.orEmpty())
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        contact.ifBlank { if (user == null) Str.accountSignIn else Str.accountProfile },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.agent567Extra.secondaryText,
                    )
                }
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = MaterialTheme.agent567Extra.secondaryText)
            }

            if (accountVerifying) Text(Str.mobileVerifying, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
            accountVerificationMessage?.let { message ->
                Agent567Card {
                    Column(Modifier.fillMaxWidth()) {
                        Text(message, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = onRefreshQuota, enabled = !quotaRefreshing) { Text(Str.mobileVerifyAgain) }
                    }
                }
            }
            if (user == null) Agent567Card { org.agent567.android.ui.components.ServiceRouteEntry(serverUrl, onOpenServiceRoute, serviceRoutes) }
            if (user != null) {
                Spacer(Modifier.height(12.dp))
                SectionHeader(title = Str.accountBalanceSection)
                Agent567Card(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(Str.mobileQuota, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.agent567Extra.secondaryText)
                            Text("$$usdFormatted", style = MaterialTheme.typography.headlineSmall)
                        }
                        IconButton(onClick = onRefreshQuota, enabled = !quotaRefreshing, modifier = Modifier.size(48.dp)) {
                            RotatingRefreshIcon(isRefreshing = quotaRefreshing, contentDescription = Str.accountRefresh)
                        }
                        TextButton(onClick = { showTopupDialog = true }, modifier = Modifier.heightIn(min = 48.dp)) { Text(Str.mobileTopupAction) }
                    }
                }
                Spacer(Modifier.height(12.dp))
                SectionHeader(title = Str.phoneModelServiceSection)
                Text(Str.phoneModelServiceHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText, modifier = Modifier.padding(bottom = 8.dp))
                Agent567Card(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 4.dp)) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button) { showGroupDialog = true }, verticalAlignment = Alignment.CenterVertically) {
                        Text(Str.mobileGroup, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        Text(activeGroup ?: Str.mobileDefaultGroup, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText, modifier = Modifier.widthIn(max = 140.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = Str.mobileSwitchGroup, modifier = Modifier.size(18.dp), tint = MaterialTheme.agent567Extra.secondaryText)
                    }
                    androidx.compose.material3.HorizontalDivider(color = MaterialTheme.agent567Extra.border)
                    org.agent567.android.ui.components.ServiceRouteEntry(serverUrl, onOpenServiceRoute, serviceRoutes)
                }
            }

            Spacer(Modifier.height(20.dp))
            SectionHeader(title = Str.settings)
            Agent567Card(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
                Agent567ListGroup {
                    ProfileRow(Icons.Default.Devices, Str.connectedDevices, "$onlineDeviceCount", onOpenDevices, showDivider = true, verticalPadding = 8.dp)
                    val nextThemeMode = when (themeMode) {
                        org.agent567.android.app.ThemeMode.Light -> org.agent567.android.app.ThemeMode.Dark
                        org.agent567.android.app.ThemeMode.Dark -> org.agent567.android.app.ThemeMode.System
                        org.agent567.android.app.ThemeMode.System -> org.agent567.android.app.ThemeMode.Light
                    }
                    ProfileRow(
                        Icons.Default.Palette,
                        Str.appearance,
                        when (themeMode) {
                            org.agent567.android.app.ThemeMode.Light -> Str.themeLight
                            org.agent567.android.app.ThemeMode.Dark -> Str.themeDark
                            org.agent567.android.app.ThemeMode.System -> Str.themeSystem
                        },
                        { onThemeMode(nextThemeMode) },
                        showDivider = false,
                        verticalPadding = 8.dp,
                        dividerStart = 16.dp,
                    )
                    androidx.compose.material3.HorizontalDivider(
                        modifier = Modifier.padding(start = 16.dp),
                        color = MaterialTheme.agent567Extra.border,
                    )
                    ProfileRow(
                        Icons.Default.CheckCircle,
                        Str.behavior,
                        null,
                        onOpenSettings,
                        showDivider = false,
                        verticalPadding = 8.dp,
                        dividerStart = 16.dp,
                    )
                    androidx.compose.material3.HorizontalDivider(
                        modifier = Modifier.padding(start = 16.dp),
                        color = MaterialTheme.agent567Extra.border,
                    )
                    ProfileRow(
                        Icons.Default.FileDownload,
                        Str.dataSection,
                        null,
                        onOpenDataSettings,
                        showDivider = false,
                        verticalPadding = 8.dp,
                        dividerStart = 16.dp,
                    )
                    androidx.compose.material3.HorizontalDivider(color = MaterialTheme.agent567Extra.border)
                    ProfileRow(Icons.Default.Info, Str.featureGuideTitle, null, { showFeatureGuide = true }, verticalPadding = 8.dp)
                    ProfileRow(Icons.Default.Info, Str.aboutUs, if (hasUpdate) Str.updateNewVersion else Str.versionNumber.removePrefix("版本 "), onOpenAbout, showDivider = false, verticalPadding = 8.dp)
                }
            }

            Spacer(Modifier.height(24.dp))
        }
    }

    if (showFeatureGuide) org.agent567.android.ui.components.FeatureGuideDialog { showFeatureGuide = false }
    if (showTopupDialog) {
        TopupDialog(
            user = user,
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


}

@Composable
internal fun BoxAvatar(name: String) {
    val letter = usernameInitial(name)
    Box(
        modifier =
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(MaterialTheme.agent567Extra.chipBackground),
        contentAlignment = Alignment.Center,
    ) {
        Text(letter, color = MaterialTheme.colorScheme.onSurface, style = MaterialTheme.typography.titleMedium)
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
    verticalPadding: androidx.compose.ui.unit.Dp = 14.dp,
    dividerStart: androidx.compose.ui.unit.Dp = 36.dp,
) {
    val rowModifier =
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .heightIn(min = 48.dp)
            .padding(vertical = verticalPadding)
    Row(
        modifier = rowModifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp), tint = MaterialTheme.agent567Extra.secondaryText)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            if (!subtitle.isNullOrBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.agent567Extra.secondaryText,
                )
            }
        }
        if (!value.isNullOrBlank()) {
            Text(value, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
            Spacer(Modifier.width(4.dp))
        }
        if (onClick != null) {
            Icon(
                Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = MaterialTheme.agent567Extra.secondaryText,
            )
        }
    }
    if (showDivider) {
        androidx.compose.material3.HorizontalDivider(
            modifier = Modifier.padding(start = dividerStart),
            color = MaterialTheme.agent567Extra.border,
        )
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
    subscriptionLoadFailed: Boolean = false,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onLogin: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.agent567Extra.pageBackground,
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
                        containerColor = MaterialTheme.agent567Extra.pageBackground,
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
            Agent567ListGroup {
                Text(
                    when {
                        subscription == null && subscriptionLoadFailed -> Str.subscriptionUnavailable
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
                        color = MaterialTheme.agent567Extra.secondaryText,
                    )
                }
            }
            Spacer(Modifier.height(12.dp))
            subscription?.windows.orEmpty().forEach { w ->
                Agent567ListGroup(modifier = Modifier.padding(vertical = 10.dp)) {
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
    section: SettingsSection,
    autoResumeLastSession: Boolean,
    motionEnabled: Boolean,
    inputPredictionEnabled: Boolean,
    migrationBackupLimitMb: Int,
    onMigrationBackupLimitMb: (Int) -> Unit,
    onAutoResumeLastSession: (Boolean) -> Unit,
    onMotionEnabled: (Boolean) -> Unit,
    onInputPredictionEnabled: (Boolean) -> Unit,
    onClearLocalData: () -> Unit,
    onExportMigration: (String, (String) -> Unit, (ByteArray?, String?) -> Unit) -> Unit,
    onSendMigration: (String, (String) -> Unit, (Boolean, String?) -> Unit) -> Unit,
    onImportMigration: (ByteArray, String, (String) -> Unit, (Int?, String?) -> Unit) -> Unit,
    onBack: () -> Unit,
    confirmBeforeDelete: Boolean,
    onConfirmBeforeDelete: (Boolean) -> Unit,
    autoRequestDesktopScreen: Boolean = false,
    onAutoRequestDesktopScreen: (Boolean) -> Unit = {},
    showBottomNavLabels: Boolean = true,
    onShowBottomNavLabels: (Boolean) -> Unit = {},
) {
    var confirmClearLocalData by remember { mutableStateOf(false) }
    var migrationDialog by remember { mutableStateOf<MigrationDialog?>(null) }
    var migrationPassword by remember { mutableStateOf("") }
    var migrationPasswordConfirm by remember { mutableStateOf("") }
    var pendingMigrationArchive by remember { mutableStateOf<ByteArray?>(null) }
    var migrationNotice by remember { mutableStateOf<String?>(null) }
    var migrationProgress by remember { mutableStateOf<String?>(null) }
    var migrationBusy by remember { mutableStateOf(false) }
    var diagnosticsNotice by remember { mutableStateOf<String?>(null) }
    var showMigrationLimitDialog by remember { mutableStateOf(false) }
    val diagnosticsFiles = rememberDiagnosticsFileActions { saved ->
        diagnosticsNotice = when (saved) {
            true -> Str.diagnosticsExportSuccess
            false -> Str.diagnosticsExportFailure
            null -> null
        }
    }
    val migrationFiles = rememberMigrationBackupFileActions(
        onOpened = { bytes, error ->
            if (error != null) {
                migrationNotice = when (error) {
                    MigrationBackupFileError.TooLarge -> Str.migrationImportTooLarge
                    MigrationBackupFileError.Access -> Str.migrationFileReadFailure
                }
            } else if (bytes != null) {
                pendingMigrationArchive = bytes
                migrationPassword = ""
                migrationDialog = MigrationDialog.Import
            }
        },
        onSaved = { saved, error ->
            migrationNotice = when {
                saved -> Str.migrationExportSuccess
                error == null -> Str.migrationSaveCancelled
                error == MigrationBackupFileError.TooLarge -> Str.migrationSaveTooLarge
                else -> Str.migrationSaveFailure
            }
        },
    )
    Scaffold(
        containerColor = MaterialTheme.agent567Extra.pageBackground,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        if (section == SettingsSection.Behavior) Str.behavior else Str.dataSection,
                        style = MaterialTheme.typography.titleMedium,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                colors =
                    TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.agent567Extra.pageBackground,
                    ),
            )
        },
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, top = 16.dp, end = 20.dp, bottom = 32.dp),
        ) {
            when (section) {
                SettingsSection.Behavior -> {
                        Text(
                            Str.settingsBehaviorSummary,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.agent567Extra.secondaryText,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                        )
                        Spacer(Modifier.height(10.dp))
                        Agent567Card {
                            Agent567ListGroup {
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
                                    showDivider = true,
                                )
                                PreferenceSwitchRow(
                                    title = Str.inputPrediction,
                                    subtitle = Str.inputPredictionHint,
                                    checked = inputPredictionEnabled,
                                    onCheckedChange = onInputPredictionEnabled,
                                    showDivider = true,
                                )
                                PreferenceSwitchRow(
                                    title = "进入设备页时自动申请屏幕共享",
                                    subtitle = "关闭后不会自动请求；仍可在设备页手动查看屏幕。",
                                    checked = autoRequestDesktopScreen,
                                    onCheckedChange = onAutoRequestDesktopScreen,
                                    showDivider = true,
                                )
                                PreferenceSwitchRow(
                                    title = "显示底部导航文字",
                                    subtitle = "控制首页、会话、工具、设备和我的下方是否显示文字。",
                                    checked = showBottomNavLabels,
                                    onCheckedChange = onShowBottomNavLabels,
                                    showDivider = false,
                                )
                            }
                        }
                }
                SettingsSection.Data -> {
                        Text(
                            Str.migrationBackupHint.replace("{limit}", migrationBackupLimitMb.toString()),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.agent567Extra.secondaryText,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                        )
                        Spacer(Modifier.height(10.dp))
                        Agent567Card {
                            Agent567ListGroup {
                                ProfileRow(
                                    Icons.Default.Settings,
                                    Str.migrationBackupLimit,
                                    "$migrationBackupLimitMb MB",
                                    onClick = { showMigrationLimitDialog = true },
                                )
                                ProfileRow(
                                    Icons.Default.FileDownload,
                                    Str.exportChatHistory,
                                    null,
                                    onClick = {
                                        migrationPassword = ""
                                        migrationPasswordConfirm = ""
                                        migrationDialog = MigrationDialog.Export
                                    },
                                )
                                ProfileRow(
                                    Icons.Default.FileUpload,
                                    Str.importChatHistory,
                                    null,
                                    onClick = migrationFiles.open,
                                )
                                ProfileRow(
                                    Icons.Default.FileDownload,
                                    Str.diagnosticsDialogTitle,
                                    null,
                                    onClick = diagnosticsFiles.export,
                                    subtitle = Str.exportDiagnosticsHint,
                                )
                                ProfileRow(
                                    Icons.Default.DeleteSweep,
                                    Str.clearLocalData,
                                    null,
                                    onClick = { confirmClearLocalData = true },
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
                        }
                }
            }
        }
    }

    fun exportMigration(password: String, sendToDesktop: Boolean) {
        migrationBusy = true
        migrationProgress = Str.migrationProgressCollecting
        if (sendToDesktop) {
            onSendMigration(password, { migrationProgress = it }) { sent, error ->
                migrationBusy = false
                migrationDialog = null
                migrationNotice = if (sent) Str.migrationSendSuccess else error ?: Str.migrationSendFailure
            }
            return
        }
        onExportMigration(password, { migrationProgress = it }) { bytes, error ->
            if (bytes == null) {
                migrationBusy = false
                migrationDialog = null
                migrationNotice = error ?: Str.migrationExportFailure
            } else {
                migrationBusy = false
                migrationDialog = null
                migrationFiles.save(bytes)
            }
        }
    }

    migrationDialog?.let { mode ->
        AlertDialog(
            onDismissRequest = {
                if (migrationBusy) return@AlertDialog
                migrationDialog = null
                pendingMigrationArchive?.fill(0)
                pendingMigrationArchive = null
            },
            title = { Text(if (mode == MigrationDialog.Export) Str.migrationExportTitle else Str.migrationImportTitle) },
            text = {
                Column {
                    Text(if (mode == MigrationDialog.Export) Str.migrationPasswordHint else Str.migrationImportPasswordHint)
                    if (mode == MigrationDialog.Import) {
                        Spacer(Modifier.height(8.dp))
                        Text(Str.migrationImportMergeHint, style = MaterialTheme.typography.bodySmall)
                    }
                    Spacer(Modifier.height(12.dp))
                    if (migrationBusy) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                            Spacer(Modifier.width(10.dp))
                            Text(migrationProgress ?: Str.migrationProgressCollecting)
                        }
                        Spacer(Modifier.height(12.dp))
                    }
                    if (!migrationBusy) {
                        OutlinedTextField(
                            value = migrationPassword,
                            onValueChange = { if (it.length <= 128) migrationPassword = it },
                            singleLine = true,
                            visualTransformation = PasswordVisualTransformation(),
                            label = { Text(Str.migrationPasswordLabel) },
                        )
                        if (mode == MigrationDialog.Export) {
                            Spacer(Modifier.height(8.dp))
                            OutlinedTextField(
                                value = migrationPasswordConfirm,
                                onValueChange = { if (it.length <= 128) migrationPasswordConfirm = it },
                                singleLine = true,
                                visualTransformation = PasswordVisualTransformation(),
                                label = { Text(Str.migrationPasswordConfirmLabel) },
                            )
                            if (migrationPasswordConfirm.isNotEmpty() && migrationPasswordConfirm != migrationPassword) {
                                Text(Str.migrationPasswordMismatch, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                val validPassword = !migrationBusy && migrationPassword.length >= 8 &&
                    (mode == MigrationDialog.Import || migrationPassword == migrationPasswordConfirm)
                if (mode == MigrationDialog.Export) {
                    Row {
                        TextButton(
                            enabled = validPassword,
                            onClick = {
                                val password = migrationPassword
                                migrationPassword = ""
                                migrationPasswordConfirm = ""
                                exportMigration(password, sendToDesktop = false)
                            },
                        ) { Text(Str.migrationSaveToFile) }
                        TextButton(
                            enabled = validPassword,
                            onClick = {
                                val password = migrationPassword
                                migrationPassword = ""
                                migrationPasswordConfirm = ""
                                exportMigration(password, sendToDesktop = true)
                            },
                        ) { Text(Str.migrationSendToDesktop) }
                    }
                } else {
                    TextButton(
                        enabled = validPassword,
                        onClick = {
                        val password = migrationPassword
                        migrationPassword = ""
                        migrationPasswordConfirm = ""
                        migrationBusy = true
                        migrationProgress = Str.migrationProgressCollecting
                        val archive = pendingMigrationArchive
                        pendingMigrationArchive = null
                        if (archive != null) {
                            onImportMigration(archive, password, { migrationProgress = it }) { count, error ->
                                migrationBusy = false
                                migrationDialog = null
                                migrationNotice = if (count != null) {
                                    "${Str.migrationImportSuccess}（$count 个会话）"
                                } else {
                                    error ?: Str.migrationFileReadFailure
                                }
                            }
                        } else {
                            migrationBusy = false
                            migrationDialog = null
                            migrationNotice = Str.migrationFileReadFailure
                        }
                        },
                    ) { Text(Str.migrationContinue) }
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    if (migrationBusy) return@TextButton
                    migrationDialog = null
                    pendingMigrationArchive?.fill(0)
                    pendingMigrationArchive = null
                    migrationProgress = null
                }) { Text(Str.cancel) }
            },
        )
    }

    if (showMigrationLimitDialog) {
        AlertDialog(
            onDismissRequest = { showMigrationLimitDialog = false },
            title = { Text(Str.migrationBackupLimit) },
            text = {
                Column {
                    Text(Str.migrationBackupLimitDescription)
                    MIGRATION_BACKUP_LIMIT_OPTIONS_MB.forEach { limitMb ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    onMigrationBackupLimitMb(limitMb)
                                    showMigrationLimitDialog = false
                                },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(
                                selected = migrationBackupLimitMb == limitMb,
                                onClick = {
                                    onMigrationBackupLimitMb(limitMb)
                                    showMigrationLimitDialog = false
                                },
                            )
                            Text("$limitMb MB")
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showMigrationLimitDialog = false }) { Text(Str.close) }
            },
        )
    }

    migrationNotice?.let { message ->
        AlertDialog(
            onDismissRequest = { migrationNotice = null },
            title = { Text(Str.migrationDialogTitle) },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { migrationNotice = null }) { Text(Str.confirm) } },
        )
    }

    diagnosticsNotice?.let { message ->
        AlertDialog(
            onDismissRequest = { diagnosticsNotice = null },
            title = { Text(Str.diagnosticsDialogTitle) },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { diagnosticsNotice = null }) { Text(Str.confirm) } },
        )
    }

    if (confirmClearLocalData) {
        Agent567ConfirmDialog(
            destructive = true,
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

private enum class MigrationDialog { Export, Import }

enum class SettingsSection { Behavior, Data }

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
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
        }
        androidx.compose.material3.Switch(checked = checked, onCheckedChange = null)
    }
    if (showDivider) {
        androidx.compose.material3.HorizontalDivider(
            modifier = Modifier.padding(start = 16.dp),
            color = MaterialTheme.agent567Extra.border,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AboutScreen(
    onBack: () -> Unit,
    onCheckUpdate: ((org.agent567.android.core.api.AppUpdateCheckResult) -> Unit) -> Unit = {},
    knownUpdate: org.agent567.android.core.api.AppUpdateCheckResult? = null,
    downloadSource: String = "github",
    customDownloadPrefix: String = "",
    onSaveDownloadSource: (source: String, customPrefix: String) -> Boolean = { _, _ -> false },
) {
    val releaseApkCompatible = org.agent567.android.ui.updates.canUseReleaseApk()
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    var checkingUpdate by remember { mutableStateOf(false) }
    var updateResult by remember(knownUpdate) { mutableStateOf(knownUpdate) }
    var updateOpenError by remember { mutableStateOf<String?>(null) }
    var showNoUpdateNotice by remember { mutableStateOf(false) }
    var updateCheckError by remember { mutableStateOf<String?>(null) }
    var showDownloadSourceDialog by remember { mutableStateOf(false) }
    var selectedDownloadSource by remember(downloadSource) { mutableStateOf(downloadSource) }
    var editedDownloadPrefix by remember(customDownloadPrefix) { mutableStateOf(customDownloadPrefix) }
    var downloadSourceSaved by remember { mutableStateOf(false) }
    var downloadSourceSaveFailed by remember { mutableStateOf(false) }
    var openDocument by remember { mutableStateOf<AboutDocument?>(null) }
    Scaffold(
        containerColor = MaterialTheme.agent567Extra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.aboutAgent567, style = MaterialTheme.typography.titleMedium) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = Str.back)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.agent567Extra.pageBackground),
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
            androidx.compose.foundation.Image(
                org.jetbrains.compose.resources.painterResource(org.agent567.android.resources.Res.drawable.brand_icon),
                contentDescription = Str.appName,
                modifier = Modifier.size(72.dp),
            )
            Spacer(Modifier.height(16.dp))
            Text(Str.appName, style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Text(Str.versionNumber, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
            Spacer(Modifier.height(24.dp))
            Text(Str.aboutDescription, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.agent567Extra.secondaryText)
            Spacer(Modifier.height(28.dp))
            Agent567ListGroup {
                ProfileRow(
                    Icons.Default.Refresh,
                    Str.updateCheck,
                    if (checkingUpdate) Str.updateChecking else "当前版本 v${AppVersion.NAME}",
                    onClick = {
                        if (checkingUpdate) return@ProfileRow
                        checkingUpdate = true
                        onCheckUpdate { result ->
                            checkingUpdate = false
                            if (result.hasUpdate) {
                                updateResult = result
                                updateOpenError = null
                            } else if (!result.error.isNullOrBlank()) {
                                updateCheckError = result.error
                            } else {
                                showNoUpdateNotice = true
                            }
                        }
                    },
                    showDivider = true,
                )
                ProfileRow(
                    Icons.Default.Settings,
                    Str.githubDownloadSource,
                    null,
                    onClick = {
                        selectedDownloadSource = downloadSource
                        editedDownloadPrefix = customDownloadPrefix
                        downloadSourceSaved = false
                        downloadSourceSaveFailed = false
                        showDownloadSourceDialog = true
                    },
                    showDivider = true,
                    subtitle = "当前：" + when (downloadSource) { "gh-proxy" -> Str.githubDownloadGhProxy; "custom" -> Str.githubDownloadCustom; else -> Str.githubDownloadDirect },
                )
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
        Agent567InfoDialog(
            title = title,
            message = body,
            onDismiss = { openDocument = null },
        )
    }

    updateResult?.let { update ->
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { updateResult = null },
            title = {
                Text("${Str.updateNewVersion} ${update.latestVersion}", style = MaterialTheme.typography.titleLarge)
            },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text(
                        if (update.releaseNotes.isNotBlank()) update.releaseNotes else Str.updateHint,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    if (!updateOpenError.isNullOrBlank()) {
                        Spacer(Modifier.height(12.dp))
                        Text(
                            updateOpenError.orEmpty(),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            },
            confirmButton = {
                androidx.compose.material3.FilledTonalButton(
                    onClick = {
                        val targetUrl = update.apkUrl?.takeIf { releaseApkCompatible && it.isNotBlank() }
                            ?: "https://github.com/Chinachani/567-agent/releases/latest"
                        try {
                            uriHandler.openUri(targetUrl)
                            updateResult = null
                            updateOpenError = null
                        } catch (_: Exception) {
                            updateOpenError = "无法打开下载页面，请检查浏览器或网络后重试。"
                        }
                    },
                ) {
                    Text(if (releaseApkCompatible && !update.apkUrl.isNullOrBlank()) Str.githubDownloadPackage else Str.updateOpenRelease)
                }
            },
            dismissButton = {
                Row {
                    TextButton(onClick = { updateResult = null }) {
                        Text(Str.updateLater)
                    }
                }
            },
        )
    }

    if (showDownloadSourceDialog) {
        val prefixValid = normalizeGitHubDownloadPrefix(editedDownloadPrefix) != null
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showDownloadSourceDialog = false },
            title = { Text(Str.githubDownloadSettings) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    listOf(
                        "github" to Str.githubDownloadDirect,
                        "gh-proxy" to Str.githubDownloadGhProxy,
                        "custom" to Str.githubDownloadCustom,
                    ).forEach { (source, label) ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    selectedDownloadSource = source
                                    downloadSourceSaved = false
                                    downloadSourceSaveFailed = false
                                },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(
                                selected = selectedDownloadSource == source,
                                onClick = {
                                    selectedDownloadSource = source
                                    downloadSourceSaved = false
                                    downloadSourceSaveFailed = false
                                },
                            )
                            Text(label, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    if (selectedDownloadSource == "custom") {
                        OutlinedTextField(
                            value = editedDownloadPrefix,
                            onValueChange = {
                                editedDownloadPrefix = it
                                downloadSourceSaved = false
                                downloadSourceSaveFailed = false
                            },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text(Str.githubDownloadPrefixLabel) },
                            placeholder = { Text(Str.githubDownloadPrefixExample) },
                            singleLine = true,
                            isError = editedDownloadPrefix.isNotBlank() && !prefixValid,
                        )
                        Text(
                            if (editedDownloadPrefix.isNotBlank() && !prefixValid) Str.githubDownloadPrefixInvalid
                            else Str.githubDownloadPrefixExample,
                            style = MaterialTheme.typography.bodySmall,
                            color = if (editedDownloadPrefix.isNotBlank() && !prefixValid) MaterialTheme.colorScheme.error
                            else MaterialTheme.agent567Extra.secondaryText,
                        )
                    }
                    if (downloadSourceSaved) {
                        Text(Str.githubDownloadSaved, style = MaterialTheme.typography.bodySmall)
                    }
                    if (downloadSourceSaveFailed) {
                        Text(Str.githubDownloadSaveFailed, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                    }
                }
            },
            confirmButton = {
                androidx.compose.material3.TextButton(
                    enabled = selectedDownloadSource != "custom" || prefixValid,
                    onClick = {
                        val prefix = if (selectedDownloadSource == "custom") normalizeGitHubDownloadPrefix(editedDownloadPrefix).orEmpty() else editedDownloadPrefix
                        downloadSourceSaved = onSaveDownloadSource(selectedDownloadSource, prefix)
                        downloadSourceSaveFailed = !downloadSourceSaved
                        if (downloadSourceSaved) updateResult = null
                    },
                ) { Text(Str.githubDownloadSave) }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = { showDownloadSourceDialog = false }) {
                    Text(Str.githubDownloadCancel)
                }
            },
        )
    }

    if (showNoUpdateNotice) {
        Agent567InfoDialog(
            title = "检查更新",
            message = "当前已是最新版本 (v${AppVersion.NAME})，暂无可用更新。",
            onDismiss = { showNoUpdateNotice = false },
        )
    }

    updateCheckError?.let { error ->
        Agent567InfoDialog(
            title = "检查更新失败",
            message = error,
            onDismiss = { updateCheckError = null },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GroupSelectionDialog(
    activeGroup: String?,
    availableGroups: Map<String, org.agent567.android.core.api.ApiGroupInfoDto>,
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
            Text("切换分组将自动接入对应渠道的模型和倍率", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
            Spacer(Modifier.height(16.dp))

            if (availableGroups.isEmpty()) {
                Text("暂无可用分组，请检查网络或重新登录", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.agent567Extra.secondaryText)
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
                                    Text(info.desc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
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
    user: User?,
    onDismiss: () -> Unit,
    onTopupWithKey: (String, (Boolean, String) -> Unit) -> Unit,
    onCreatePayOrder: (Int, String, (org.agent567.android.core.PayOrderResult, Double) -> Unit, (String) -> Unit) -> Unit,
    onRefreshQuota: () -> Unit,
) {
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    var activeTab by rememberSaveable { mutableStateOf(0) } // 0: 在线充值, 1: 卡密兑换
    var selectedAmount by rememberSaveable { mutableStateOf(20) }
    var customAmountText by rememberSaveable { mutableStateOf("") }
    var payMethod by rememberSaveable { mutableStateOf("alipay") }
    var cdkeyText by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var isError by remember { mutableStateOf(false) }
    var payingNotice by remember { mutableStateOf(false) }
    var initialQuota by remember { mutableStateOf<Double?>(null) }
    var paySuccess by remember { mutableStateOf(false) }
    var paymentPollExpired by remember { mutableStateOf(false) }
    val paymentUnavailable = activeTab == 0 && org.agent567.android.core.api.isPaymentUnavailable(message.orEmpty())

    LaunchedEffect(payingNotice, paySuccess) {
        if (!payingNotice) return@LaunchedEffect
        repeat(180) {
            if (paySuccess) return@LaunchedEffect
            delay(5000)
            onRefreshQuota()
        }
        if (!paySuccess) {
            paymentPollExpired = true
            message = Str.topupPollStopped
            isError = false
        }
    }

    LaunchedEffect(user?.quotaUsd) {
        val curr = user?.quotaUsd
        if (payingNotice && initialQuota != null && curr != null && curr > initialQuota!!) {
            paySuccess = true
            delay(1500)
            onDismiss()
        }
    }

    androidx.compose.material3.ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = androidx.compose.material3.rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.surface,
        dragHandle = { androidx.compose.material3.BottomSheetDefaults.DragHandle() },
    ) {
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = maxHeight * 0.9f)
                    .wrapContentHeight()
                    .padding(horizontal = 24.dp),
            ) {
            Column(
                modifier = Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState()),
            ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(Str.topupTitle, style = MaterialTheme.typography.titleLarge.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.DeleteSweep, contentDescription = Str.close, modifier = Modifier.size(20.dp))
                }
            }
            Spacer(Modifier.height(12.dp))

            if (paySuccess) {
                Spacer(Modifier.height(24.dp))
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        Icons.Default.CheckCircle,
                        contentDescription = Str.success,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(56.dp),
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(Str.topupSuccess, style = MaterialTheme.typography.titleMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
                    Text(Str.topupCredited, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.agent567Extra.secondaryText)
                }
                Spacer(Modifier.height(32.dp))
            } else 

            // Tab 切换
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f), androidx.compose.foundation.shape.RoundedCornerShape(10.dp))
                    .padding(4.dp),
            ) {
                listOf(Str.topupOnline, Str.topupRedeem).forEachIndexed { idx, title ->
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
                            color = if (isSel) MaterialTheme.colorScheme.primary else MaterialTheme.agent567Extra.secondaryText,
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            if (paymentUnavailable) {
                Agent567Card {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(Str.topupUnavailable, style = MaterialTheme.typography.titleMedium)
                        Text(Str.topupUnavailableHint, style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = { activeTab = 1; message = null }) { Text(Str.topupUseCode) }
                        TextButton(onClick = { message = null }) { Text(Str.topupChangePayment) }
                    }
                }
            }
            if (message != null && !paymentUnavailable) {
                Text(
                    text = message!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }

            if (activeTab == 0 && !paymentUnavailable) {
                // 在线充值 (易支付)
                Text(Str.topupChooseMethod, style = MaterialTheme.typography.labelMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
                Spacer(Modifier.height(8.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("alipay" to Str.topupAlipay, "wxpay" to Str.topupWechat).forEach { (method, label) ->
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
                Text(Str.topupAmount, style = MaterialTheme.typography.labelMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
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
                org.agent567.android.ui.components.Agent567TextField(
                    value = customAmountText,
                    onValueChange = { customAmountText = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text(Str.topupCustom) },
                )

                if (payingNotice) {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        if (paymentPollExpired) Str.topupManualHint else Str.topupExternalHint,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Spacer(Modifier.height(8.dp))
                    androidx.compose.material3.OutlinedButton(
                            onClick = { onRefreshQuota() },
                        modifier = Modifier.fillMaxWidth(),
                        shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
                    ) {
                        Text(Str.topupPaid, style = MaterialTheme.typography.labelMedium)
                    }
                }

            } else if (activeTab != 0) {
                // 卡密兑换
                Text(Str.topupCodePrompt, style = MaterialTheme.typography.labelMedium.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Bold))
                Spacer(Modifier.height(8.dp))
                org.agent567.android.ui.components.Agent567TextField(
                    value = cdkeyText,
                    onValueChange = { cdkeyText = it; message = null },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text(Str.topupCodeLabel) },
                )
            }
                Spacer(Modifier.height(16.dp))
            }

            Spacer(Modifier.height(8.dp))
            if (!paySuccess && !paymentUnavailable) {
                PrimaryBlackButton(
                    text = when {
                        loading && activeTab == 0 -> Str.topupCreating
                        loading -> Str.topupRedeeming
                        activeTab == 0 -> Str.topupPay
                        else -> Str.topupRedeemAction
                    },
                    onClick = {
                        if (activeTab == 0) {
                            val customAmount = customAmountText.trim()
                            val finalAmt = if (customAmount.isEmpty()) selectedAmount else customAmount.toIntOrNull()
                            if (finalAmt == null) {
                                message = Str.topupInvalidAmount
                                isError = true
                            } else if (finalAmt < 1) {
                                message = Str.topupMinimumAmount
                                isError = true
                            } else {
                                loading = true
                                message = null
                                paymentPollExpired = false
                                paySuccess = false
                                onCreatePayOrder(finalAmt, payMethod, { payResult, freshQuotaUsd ->
                                    loading = false
                                    initialQuota = freshQuotaUsd
                                    payingNotice = true
                                    val launched = if (!payResult.urlScheme.isNullOrBlank()) {
                                        runCatching {
                                            uriHandler.openUri(payResult.urlScheme)
                                            true
                                        }.getOrDefault(false)
                                    } else false
                                    if (!launched) runCatching { uriHandler.openUri(payResult.payUrl) }
                                }, { err ->
                                    loading = false
                                    message = err
                                    isError = true
                                })
                            }
                        } else if (cdkeyText.isBlank()) {
                            message = Str.topupCodeRequired
                            isError = true
                        } else {
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
                        }
                    },
                    enabled = !loading && (activeTab == 0 || cdkeyText.isNotBlank()),
                )
            }
            Spacer(Modifier.height(8.dp))
            }
        }
    }
}

internal fun usernameInitial(name: String): String {
    val trimmed = name.trim()
    if (trimmed.isEmpty()) return "?"
    val count = if (trimmed.length >= 2 && trimmed[0].isHighSurrogate() && trimmed[1].isLowSurrogate()) 2 else 1
    return trimmed.take(count).uppercase()
}
