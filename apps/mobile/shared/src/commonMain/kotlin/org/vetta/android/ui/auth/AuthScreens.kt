package org.vetta.android.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeContentPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import org.vetta.android.domain.error.UiError
import org.vetta.android.ui.components.PrimaryBlackButton
import org.vetta.android.ui.components.VettaTextField
import org.vetta.android.ui.components.VettaErrorBanner
import org.vetta.android.ui.i18n.Str
import org.vetta.android.ui.remote.PairingScannerButton
import org.vetta.android.ui.theme.vettaExtra

@Composable
fun WelcomeScreen(
    connecting: Boolean,
    error: UiError?,
    onLogin: () -> Unit,
    onScanPairing: (String) -> Unit,
    onSkip: () -> Unit,
    onClearError: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .safeContentPadding()
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(Str.welcomeTitle, style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(12.dp))
        Text(
            Str.welcomeSubtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.vettaExtra.secondaryText,
        )
        Spacer(Modifier.height(28.dp))
        FeatureRow(Icons.Default.Computer, Str.featureDesktop, Str.featureDesktopDesc)
        FeatureRow(Icons.Default.Cloud, Str.featureCloud, Str.featureCloudDesc)
        FeatureRow(Icons.Default.Schedule, Str.featureStatus, Str.featureStatusDesc)
        FeatureRow(Icons.Default.Lock, Str.featureSecure, Str.featureSecureDesc)
        Spacer(Modifier.height(28.dp))
        PrimaryBlackButton(text = Str.getStarted, onClick = onLogin)
        Spacer(Modifier.height(10.dp))
        if (!connecting) {
            PairingScannerButton(
                onScanned = onScanPairing,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                label = Str.scanPairing,
            )
        }
        TextButton(
            onClick = onSkip,
            modifier = Modifier.align(Alignment.CenterHorizontally),
        ) {
            Text(Str.skipForNow, color = MaterialTheme.vettaExtra.secondaryText)
        }
        if (error != null) {
            Spacer(Modifier.height(12.dp))
            VettaErrorBanner(error = error, onDismiss = onClearError)
        }
        if (connecting) {
            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier.align(Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text(
                    Str.connectingDesktop,
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.vettaExtra.secondaryText,
                )
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun FeatureRow(
    icon: ImageVector,
    title: String,
    desc: String,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Column {
            Text(title, style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(2.dp))
            Text(desc, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.vettaExtra.secondaryText)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    loading: Boolean,
    error: UiError?,
    loginModeEmail: Boolean,
    passwordVisible: Boolean,
    onToggleMode: (Boolean) -> Unit,
    onTogglePassword: (Boolean) -> Unit,
    onLogin: (account: String, password: String) -> Unit,
    onClearError: () -> Unit,
    onBack: () -> Unit,
    onSendVerification: (String, (Boolean, String) -> Unit) -> Unit = { _, _ -> },
    onRegister: (String, String, String, String, String?) -> Unit = { _, _, _, _, _ -> },
) {
    var account by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    var isRegisterMode by remember { mutableStateOf(false) }
    var regUsername by remember { mutableStateOf("") }
    var regEmail by remember { mutableStateOf("") }
    var regCode by remember { mutableStateOf("") }
    var regPassword by remember { mutableStateOf("") }
    var regConfirmPassword by remember { mutableStateOf("") }
    var regAffCode by remember { mutableStateOf("") }
    var sendingCode by remember { mutableStateOf(false) }
    var codeNotice by remember { mutableStateOf<String?>(null) }
    var localError by remember { mutableStateOf<String?>(null) }

    Scaffold(
        containerColor = MaterialTheme.vettaExtra.pageBackground,
        topBar = {
            TopAppBar(
                title = { Text(Str.loginTitle, style = MaterialTheme.typography.titleMedium) },
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
            modifier =
                Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 28.dp),
                verticalArrangement = Arrangement.Top,
        ) {
            Text(
                if (isRegisterMode) "注册 567 API 账户，畅享全能 AI 编码体验" else Str.loginSubtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.vettaExtra.secondaryText,
            )
            Spacer(Modifier.height(16.dp))
            if (error != null) {
                VettaErrorBanner(error = error, onDismiss = onClearError)
                Spacer(Modifier.height(12.dp))
            }
            if (localError != null) {
                Text(
                    text = localError!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }
            if (codeNotice != null) {
                Text(
                    text = codeNotice!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
            }

            if (isRegisterMode) {
                // 注册表单
                VettaTextField(
                    value = regUsername,
                    onValueChange = { regUsername = it; localError = null },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("用户名") },
                )
                Spacer(Modifier.height(10.dp))
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    VettaTextField(
                        value = regEmail,
                        onValueChange = { regEmail = it; localError = null },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        label = { Text("邮箱地址") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    )
                    Spacer(Modifier.width(8.dp))
                    TextButton(
                        onClick = {
                            if (regEmail.isBlank()) {
                                localError = "请输入有效的邮箱地址"
                                return@TextButton
                            }
                            sendingCode = true
                            localError = null
                            onSendVerification(regEmail.trim()) { ok, msg ->
                                sendingCode = false
                                if (ok) {
                                    codeNotice = msg
                                } else {
                                    localError = msg
                                }
                            }
                        },
                        enabled = !sendingCode && regEmail.isNotBlank(),
                        modifier = Modifier.height(48.dp),
                    ) {
                        Text(if (sendingCode) "发送中..." else "获取验证码", style = MaterialTheme.typography.labelMedium)
                    }
                }
                Spacer(Modifier.height(10.dp))
                VettaTextField(
                    value = regCode,
                    onValueChange = { regCode = it; localError = null },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("邮箱验证码") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
                Spacer(Modifier.height(10.dp))
                VettaTextField(
                    value = regPassword,
                    onValueChange = { regPassword = it; localError = null },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("密码 (≥8位)") },
                    visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
                Spacer(Modifier.height(10.dp))
                VettaTextField(
                    value = regConfirmPassword,
                    onValueChange = { regConfirmPassword = it; localError = null },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("确认密码") },
                    visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                )
                Spacer(Modifier.height(10.dp))
                VettaTextField(
                    value = regAffCode,
                    onValueChange = { regAffCode = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text("邀请码 (可选)") },
                )
                Spacer(Modifier.height(20.dp))
                PrimaryBlackButton(
                    text = if (loading) "正在注册..." else "立即注册并登录",
                    onClick = {
                        if (regUsername.isBlank() || regEmail.isBlank() || regCode.isBlank() || regPassword.isBlank()) {
                            localError = "请完整填写注册信息"
                            return@PrimaryBlackButton
                        }
                        if (regPassword.length < 8) {
                            localError = "密码长度不能少于 8 位"
                            return@PrimaryBlackButton
                        }
                        if (regPassword != regConfirmPassword) {
                            localError = "两次输入的密码不一致"
                            return@PrimaryBlackButton
                        }
                        localError = null
                        onRegister(regUsername.trim(), regPassword.trim(), regEmail.trim(), regCode.trim(), regAffCode.trim().takeIf { it.isNotBlank() })
                    },
                    enabled = !loading && regUsername.isNotBlank() && regEmail.isNotBlank() && regCode.isNotBlank() && regPassword.isNotBlank(),
                )
                TextButton(
                    onClick = { isRegisterMode = false; localError = null; codeNotice = null },
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                ) {
                    Text("已有账号？返回登录", color = MaterialTheme.colorScheme.primary)
                }
            } else {
                // 登录表单
                VettaTextField(
                    value = account,
                    onValueChange = { account = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    label = { Text(if (loginModeEmail) Str.email else Str.account) },
                    keyboardOptions =
                        KeyboardOptions(
                            keyboardType = if (loginModeEmail) KeyboardType.Password else KeyboardType.Text,
                            imeAction = if (loginModeEmail) ImeAction.Done else ImeAction.Next,
                        ),
                    keyboardActions =
                        KeyboardActions(
                            onDone = {
                                if (!loading && account.isNotBlank()) {
                                    onLogin(account.trim(), if (loginModeEmail) "" else password)
                                }
                            },
                        ),
                )
                if (!loginModeEmail) {
                    Spacer(Modifier.height(12.dp))
                    VettaTextField(
                        value = password,
                        onValueChange = { password = it },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        label = { Text(Str.password) },
                        visualTransformation =
                            if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                        trailingIcon = {
                            IconButton(onClick = { onTogglePassword(!passwordVisible) }) {
                                Icon(
                                    if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription =
                                        if (passwordVisible) Str.hidePassword else Str.showPassword,
                                )
                            }
                        },
                        keyboardOptions =
                            KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done,
                            ),
                        keyboardActions =
                            KeyboardActions(
                                onDone = {
                                    if (!loading && account.isNotBlank() && password.isNotBlank()) {
                                        onLogin(account.trim(), password)
                                    }
                                },
                            ),
                    )
                }
                Spacer(Modifier.height(20.dp))
                PrimaryBlackButton(
                    text = if (loading) Str.loggingIn else Str.loginAction,
                    onClick = { onLogin(account.trim(), if (loginModeEmail) "" else password) },
                    enabled = !loading && account.isNotBlank() && (loginModeEmail || password.isNotBlank()),
                )
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TextButton(
                        onClick = { isRegisterMode = true; localError = null; codeNotice = null },
                    ) {
                        Text("注册新账号", color = MaterialTheme.colorScheme.primary)
                    }
                    TextButton(
                        onClick = { onToggleMode(!loginModeEmail) },
                    ) {
                        Text(if (loginModeEmail) Str.useAccountLogin else Str.useEmailLogin)
                    }
                }
            }
        }
    }
}
