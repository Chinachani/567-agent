package org.agent567.android.core

import kotlinx.coroutines.flow.StateFlow
import org.agent567.android.core.api.Agent567Api
import org.agent567.android.core.auth.StoredTokens
import org.agent567.android.core.auth.TokenStore
import org.agent567.android.core.model.AuthSession
import org.agent567.android.core.model.User
import org.agent567.android.core.net.RefreshOutcome
import org.agent567.android.core.net.TokenRefresher

class AuthRepository internal constructor(
    private val api: Agent567Api,
    private val tokenStore: TokenStore,
    private val tokenRefresher: TokenRefresher,
) {
    val tokens: StateFlow<StoredTokens?> = tokenStore.tokens

    val isLoggedIn: Boolean
        get() = !tokenStore.accessToken.isNullOrBlank()

    suspend fun loginWithAccount(account: String, password: String): AuthSession =
        api.loginWithAccount(account.trim(), password)

    suspend fun loginWithAccessToken(accessToken: String): AuthSession =
        api.loginWithAccessToken(accessToken.trim())

    suspend fun loginWithEmailPassword(email: String, password: String): AuthSession =
        api.loginWithEmailPassword(email.trim(), password)

    suspend fun loginWithSms(phone: String, code: String): AuthSession =
        api.loginWithSms(phone.trim(), code.trim())

    suspend fun sendVerificationCode(email: String): String =
        api.sendVerificationCode(email)

    suspend fun register(username: String, password: String, email: String, code: String, affCode: String?): AuthSession =
        api.register(username, password, email, code, affCode)

    suspend fun sendSmsCode(phone: String) {
        api.sendSmsCode(phone.trim())
    }

    suspend fun refresh(): RefreshOutcome = tokenRefresher.refresh()

    suspend fun installSession(accessToken: String, refreshToken: String) {
        tokenRefresher.installSession(accessToken, refreshToken)
    }

    suspend fun logout() {
        tokenRefresher.clearSession()
    }

    suspend fun me(): User = api.me()

    suspend fun clearLocalSession() {
        tokenRefresher.clearSession()
    }
}
