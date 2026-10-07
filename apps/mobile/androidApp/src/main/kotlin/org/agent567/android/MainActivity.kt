package org.agent567.android

import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.tooling.preview.Preview
import org.agent567.android.app.ThemeMode

class MainActivity : ComponentActivity() {
    private var pendingPairingInvite by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as Agent567Application).appContainer
        val savedMode = container.preferences.themeMode.value
        val systemDark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val dark = when (savedMode) {
            ThemeMode.Dark -> true
            ThemeMode.Light -> false
            ThemeMode.System -> systemDark
        }
        window.setBackgroundDrawable(ColorDrawable(if (dark) Color.rgb(18, 18, 18) else Color.rgb(248, 248, 248)))
        pendingPairingInvite = pairingInviteFrom(intent)

        setContent {
            App(
                container = container,
                pairingInvite = pendingPairingInvite,
                onPairingInviteHandled = ::clearHandledPairingInvite,
            )
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingPairingInvite = pairingInviteFrom(intent)
    }

    private fun clearHandledPairingInvite() {
        pendingPairingInvite = null
        if (pairingInviteFrom(intent) != null) {
            setIntent(Intent(intent).setData(null))
        }
    }
}

internal fun pairingInviteFrom(intent: Intent): String? {
    val data = intent.data ?: return null
    return data.toString().takeIf { (data.scheme == "vetta" || data.scheme == "agent567") && data.host == "pair" }
}

@Preview
@Composable
fun AppAndroidPreview() {
    App()
}
