package org.agent567.android

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.tooling.preview.Preview
import org.agent567.android.app.AppContainer
import org.agent567.android.ui.LocalAppContainer
import org.agent567.android.ui.RootApp

@Composable
@Preview
fun App(
    container: AppContainer = remember { AppContainer.createDefault() },
    pairingInvite: String? = null,
    onPairingInviteHandled: () -> Unit = {},
) {
    CompositionLocalProvider(LocalAppContainer provides container) {
        RootApp(
            container = container,
            pairingInvite = pairingInvite,
            onPairingInviteHandled = onPairingInviteHandled,
        )
    }
}
