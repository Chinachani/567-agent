package org.agent567.android.ui.me

import org.agent567.android.ui.i18n.Str
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

internal enum class AccountSecurityAction { Password, Email }

@Composable
internal fun AccountSecurityDialog(
    action: AccountSecurityAction,
    currentEmail: String,
    onChangePassword: (String, String, (String?) -> Unit) -> Unit,
    onSendEmailCode: (String, (String?) -> Unit) -> Unit,
    onBindEmail: (String, String, (String?) -> Unit) -> Unit,
    onDismiss: () -> Unit,
    onSaved: (String) -> Unit,
) {
    var original by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var email by remember { mutableStateOf(currentEmail) }
    var code by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }
    var cooldown by remember { mutableStateOf(0) }
    LaunchedEffect(cooldown) { if (cooldown > 0) { delay(1_000); cooldown-- } }
    val isPassword = action == AccountSecurityAction.Password
    val validEmail = email.trim().length <= 254 && email.trim().matches(Regex("[^\\s@]+@[^\\s@]+\\.[^\\s@]+"))
    val canSave = if (isPassword) original.isNotEmpty() && password.length in 8..20 && confirmation == password else validEmail && code.isNotBlank()
    val busy = sending || saving
    AlertDialog(onDismissRequest = { if (!busy) onDismiss() }, title = { Text(if (isPassword) Str.accountChangePassword else Str.accountBindEmail) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (isPassword) {
                OutlinedTextField(original, { original = it; error = null }, label = { Text(Str.accountCurrentPassword) }, modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !busy, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                OutlinedTextField(password, { password = it; error = null }, label = { Text(Str.accountNewPassword) }, modifier = Modifier.fillMaxWidth(), supportingText = { Text(Str.accountPasswordHint) }, singleLine = true, enabled = !busy, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
                OutlinedTextField(confirmation, { confirmation = it; error = null }, label = { Text(Str.accountConfirmPassword) }, modifier = Modifier.fillMaxWidth(), isError = confirmation.isNotEmpty() && confirmation != password, singleLine = true, enabled = !busy, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
            } else {
                OutlinedTextField(email, { email = it; error = null; notice = null }, label = { Text(Str.accountEmailAddress) }, modifier = Modifier.fillMaxWidth(), singleLine = true, enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    OutlinedTextField(code, { code = it; error = null }, label = { Text(Str.accountCode) }, modifier = Modifier.weight(1f), singleLine = true, enabled = !busy)
                    TextButton(enabled = validEmail && !busy && cooldown == 0, onClick = {
                        sending = true; error = null
                        onSendEmailCode(email) { failure -> sending = false; error = failure; if (failure == null) { notice = Str.accountCodeSent; cooldown = 60 } }
                    }) { Text(if (sending) Str.accountSendingCode else if (cooldown > 0) Str.durationSeconds(cooldown.toLong()) else Str.accountSendCode) }
                }
                Text(Str.accountEmailHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            notice?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        }
    }, confirmButton = {
        TextButton(enabled = canSave && !busy, onClick = {
            saving = true; error = null
            val done: (String?) -> Unit = { failure ->
                saving = false; error = failure
                if (failure == null) { original = ""; password = ""; confirmation = ""; code = ""; onSaved(if (isPassword) Str.accountPasswordChanged else Str.accountEmailBound) }
            }
            if (isPassword) onChangePassword(original, password, done) else onBindEmail(email, code, done)
        }) { if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(Str.accountConfirmChange) }
    }, dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(Str.cancel) } })
}
