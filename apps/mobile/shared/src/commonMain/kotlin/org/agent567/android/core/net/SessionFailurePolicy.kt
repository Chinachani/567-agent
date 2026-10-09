package org.agent567.android.core.net

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private val authNoun = Regex("cookie|session|refresh|token|authentication|登录|登陆|会话|令牌|认证", RegexOption.IGNORE_CASE)
private val rejectedState = Regex("expired|invalid|revoked|unauthorized|过期|失效|无效|未授权", RegexOption.IGNORE_CASE)
private val needsLogin = Regex("not logged in|login required|未登录|未登陆|请先登录|请重新登录", RegexOption.IGNORE_CASE)

internal fun isRefreshCredentialRejected(status: Int, body: String): Boolean {
    if (status == 429 || status >= 500) return false
    if (status == 401) return true
    if (status !in setOf(200, 400, 403)) return false
    val root = runCatching { Agent567Json.parseToJsonElement(body) as? JsonObject }.getOrNull()
    val code = (root?.get("code") as? JsonPrimitive)?.content?.toIntOrNull()
    if (code in UNAUTHORIZED_CODES) return true
    val message = (root?.get("message") as? JsonPrimitive)?.content ?: body
    return needsLogin.containsMatchIn(message) ||
        (authNoun.containsMatchIn(message) && rejectedState.containsMatchIn(message))
}

internal fun isAccountLoginRejected(status: Int, message: String): Boolean {
    if (status == 429 || status >= 500) return false
    if (status == 401 || status == 403) return true
    return Regex("password|credential|username|密码|用户名|账号|账户", RegexOption.IGNORE_CASE).containsMatchIn(message) &&
        Regex("invalid|incorrect|wrong|rejected|错误|不正确|不存在|拒绝|失败", RegexOption.IGNORE_CASE).containsMatchIn(message)
}
