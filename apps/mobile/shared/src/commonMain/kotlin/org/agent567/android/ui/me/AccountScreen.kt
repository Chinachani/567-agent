package org.agent567.android.ui.me

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.agent567.android.core.model.User
import org.agent567.android.ui.components.Agent567Card
import org.agent567.android.ui.components.Agent567ChoiceDialog
import org.agent567.android.ui.i18n.Str
import org.agent567.android.ui.theme.agent567Extra

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen(
    user: User?, onBack: () -> Unit, onLogin: () -> Unit, onLogout: (Boolean) -> Unit,
    onRefresh: () -> Unit, onSaveName: (String, (String?) -> Unit) -> Unit,
    refreshing: Boolean = false, busy: Boolean = false,
    onChangePassword: (String, String, (String?) -> Unit) -> Unit = { _, _, done -> done(Str.accountUnsupported) },
    onSendEmailCode: (String, (String?) -> Unit) -> Unit = { _, done -> done(Str.accountUnsupported) },
    onBindEmail: (String, String, (String?) -> Unit) -> Unit = { _, _, done -> done(Str.accountUnsupported) },
) {
    var editing by rememberSaveable(user?.id) { mutableStateOf(false) }
    var draft by rememberSaveable(user?.id, user?.nickname) { mutableStateOf(user?.nickname.orEmpty()) }
    var saving by remember(user?.id) { mutableStateOf(false) }
    var error by remember(user?.id) { mutableStateOf<String?>(null) }
    var notice by remember(user?.id) { mutableStateOf<String?>(null) }
    var security by remember(user?.id) { mutableStateOf<AccountSecurityAction?>(null) }
    var confirmLogout by rememberSaveable(user?.id) { mutableStateOf(false) }
    Scaffold(containerColor = MaterialTheme.agent567Extra.pageBackground, topBar = {
        TopAppBar(title = { Text(Str.accountProfile, style = MaterialTheme.typography.titleLarge) }, navigationIcon = {
            IconButton(onClick = onBack, enabled = !busy) { Icon(Icons.AutoMirrored.Filled.ArrowBack, Str.back) }
        }, actions = {
            if (user != null) IconButton(onClick = onRefresh, enabled = !refreshing && !busy) {
                if (refreshing) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                else Icon(Icons.Default.Refresh, Str.accountRefresh)
            }
        }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.agent567Extra.pageBackground))
    }) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            if (user == null) {
                Text(Str.accountSignInHint, style = MaterialTheme.typography.bodyMedium)
                Button(onClick = onLogin, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(Str.accountSignIn) }
            } else {
                Column(Modifier.fillMaxWidth().padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    BoxAvatar(user.username)
                    Text(user.nickname.ifBlank { user.username }, style = MaterialTheme.typography.titleMedium)
                    Text(Str.accountId(user.id), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Agent567Card(contentPadding = PaddingValues(horizontal = 16.dp)) {
                    AccountDetailRow(Str.accountUsername, user.username)
                    HorizontalDivider(color = MaterialTheme.agent567Extra.border)
                    AccountDetailRow(Str.accountNickname, user.nickname.ifBlank { user.username }, enabled = !busy && !refreshing) { draft = user.nickname; error = null; editing = true }
                    HorizontalDivider(color = MaterialTheme.agent567Extra.border)
                    AccountDetailRow(Str.accountEmail, user.email?.takeIf(String::isNotBlank) ?: Str.accountUnbound, enabled = !busy && !refreshing) { security = AccountSecurityAction.Email }
                }
                notice?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary) }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(Str.accountSecurity, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Agent567Card(contentPadding = PaddingValues(horizontal = 16.dp)) {
                        AccountDetailRow(Str.accountChangePassword, "", enabled = !busy && !refreshing) { security = AccountSecurityAction.Password }
                    }
                }
                OutlinedButton(onClick = { confirmLogout = true }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    else Text(Str.logout, color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
    if (editing) AlertDialog(onDismissRequest = { if (!saving) editing = false }, title = { Text(Str.accountEditNickname) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(draft, { draft = it; error = null }, label = { Text(Str.accountNickname) }, supportingText = { Text(Str.accountNicknameHint) }, singleLine = true, enabled = !saving, isError = draft.trim().length > 20 || error != null)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }, confirmButton = {
        TextButton(enabled = !saving && draft.trim().length in 1..20, onClick = {
            saving = true; error = null
            onSaveName(draft) { failure -> saving = false; error = failure; if (failure == null) { editing = false; notice = Str.accountNicknameSaved } }
        }) { if (saving) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text(Str.accountSaveNickname) }
    }, dismissButton = { TextButton(onClick = { editing = false }, enabled = !saving) { Text(Str.close) } })
    security?.let { action ->
        AccountSecurityDialog(action, user?.email.orEmpty(), onChangePassword, onSendEmailCode, onBindEmail,
            onDismiss = { security = null }, onSaved = { notice = it; security = null })
    }
    if (confirmLogout) Agent567ChoiceDialog(destructive = true, title = Str.logout, message = Str.logoutConfirm, primaryLabel = Str.confirmLogout,
        onPrimary = { confirmLogout = false; onLogout(false) }, secondaryLabel = Str.logoutAndClear,
        onSecondary = { confirmLogout = false; onLogout(true) }, onDismiss = { confirmLogout = false })
}

@Composable
private fun AccountDetailRow(label: String, value: String, enabled: Boolean = true, onClick: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).then(if (onClick != null) Modifier.clickable(enabled = enabled, role = Role.Button, onClick = onClick) else Modifier).padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(value, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.End)
        if (onClick != null) Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, modifier = Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
