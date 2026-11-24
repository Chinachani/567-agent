package org.agent567.android.core.api

import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.isSuccess
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*
import org.agent567.android.app.AppPreferences
import org.agent567.android.core.auth.TokenStore
import org.agent567.android.core.error.Agent567Exception
import org.agent567.android.core.net.Agent567Json
import org.agent567.android.core.net.parseFailure

/** Account access tokens must never be used as model keys, even if management requests fail. */
internal class GroupApiCredentials(
    private val tokens: TokenStore,
    private val preferences: AppPreferences?,
    private val serviceIdentity: () -> String,
    private val sessionVersion: () -> Long,
    private val request: suspend (method: String, path: String, body: JsonObject?, version: Long) -> HttpResponse,
) {
    private val mutex = Mutex()
    private val cache = mutableMapOf<String, String>()
    private val created = mutableMapOf<String, Long>()

    suspend fun existing(group: String?): String? = mutex.withLock {
        val access = tokens.accessToken ?: return@withLock null
        if (access.startsWith("sk-")) return@withLock access
        val owner = namespace(access)
        val target = group.orEmpty().ifEmpty { "default" }
        cache["$owner:$target"] ?: preferences?.getCachedGroupKey(target, owner)
    }

    suspend fun get(group: String?, rejectedKey: String? = null, createIfMissing: Boolean = true): String = mutex.withLock {
        val access = tokens.accessToken ?: throw Agent567Exception.Unauthorized()
        if (access.startsWith("sk-")) return@withLock access
        val version = sessionVersion()
        var namespace = namespace(access)
        val target = group.orEmpty().ifEmpty { "default" }
        val cacheId = "$namespace:$target"
        val cached = cache[cacheId] ?: preferences?.getCachedGroupKey(target, namespace)
        if (!cached.isNullOrBlank() && cached != rejectedKey) return@withLock cached
        cache.remove(cacheId)
        preferences?.setCachedGroupKey(target, null, namespace)

        val targetName = if (target == "default") "567 Agent" else "567 Agent [$target]"
        fun available(item: JsonObject): Boolean {
            val status = item["status"]?.jsonPrimitive?.intOrNull
            val expires = item["expired_time"]?.jsonPrimitive?.longOrNull
            val remaining = item["remain_quota"]?.jsonPrimitive?.longOrNull
            val unlimited = item["unlimited_quota"]?.jsonPrimitive?.booleanOrNull
            return (status == null || status == 1) &&
                (expires == null || expires <= 0 || expires > System.currentTimeMillis() / 1000) &&
                (unlimited != false || remaining == null || remaining > 0)
        }
        fun matches(item: JsonObject): Boolean {
            val actual = item["group"]?.jsonPrimitive?.contentOrNull
            return available(item) && (if (actual.isNullOrBlank()) target == "default" || item["name"]?.jsonPrimitive?.contentOrNull == targetName
                else actual == target)
        }
        suspend fun list(): List<JsonObject> {
            val root = checked(version, "GET", "/api/token/?p=0&size=100")
            val data = root["data"] ?: root
            val items = data as? JsonArray ?: (data as? JsonObject)?.let {
                it["items"] as? JsonArray ?: it["data"] as? JsonArray ?: it["tokens"] as? JsonArray
            } ?: throw Agent567Exception.Protocol("无法读取模型授权列表，请稍后重试")
            return items.mapNotNull { it as? JsonObject }
        }
        var item = list().firstOrNull(::matches)
        var createdNow = false
        if (item == null && createIfMissing) {
            checked(version, "POST", "/api/token/", buildJsonObject {
                put("name", targetName)
                if (target != "default") put("group", target)
                put("remain_quota", 0)
                put("expired_time", -1)
                put("unlimited_quota", true)
            })
            createdNow = true
            item = list().firstOrNull(::matches)
        }
        val selected = item ?: throw Agent567Exception.Protocol("未能获取当前分组的模型授权，请重试")
        val id = selected["id"]?.jsonPrimitive?.longOrNull
        var key = selected["key"]?.jsonPrimitive?.contentOrNull
        if (key.isNullOrBlank() || key.contains('*')) {
            if (id == null) throw Agent567Exception.Protocol("模型授权缺少编号，请重试")
            val data = checked(version, "POST", "/api/token/$id/key", buildJsonObject {})["data"]
            key = (data as? JsonPrimitive)?.contentOrNull ?: (data as? JsonObject)?.get("key")?.jsonPrimitive?.contentOrNull
        }
        if (key.isNullOrBlank() || key.contains('*') || key.length < 20)
            throw Agent567Exception.Protocol("未能读取模型授权，请重试")
        if (version != sessionVersion() || tokens.accessToken == null) throw Agent567Exception.Unauthorized()
        val result = if (key.startsWith("sk-")) key else "sk-$key"
        // A successful cookie renewal can rotate the account token during the lookup.
        namespace = namespace(tokens.accessToken!!)
        val finalId = "$namespace:$target"
        cache[finalId] = result
        preferences?.setCachedGroupKey(target, result, namespace)
        if (createdNow && id != null) created[finalId] = id
        result
    }

    suspend fun cleanup(group: String?) = mutex.withLock {
        if (group.isNullOrBlank()) return@withLock
        val access = tokens.accessToken ?: return@withLock
        val namespace = namespace(access)
        val cacheId = "$namespace:$group"
        cache.remove(cacheId)
        preferences?.setCachedGroupKey(group, null, namespace)
        // Only remove tokens this instance actually created; never delete a user's key to repair a cache.
        val id = created.remove(cacheId) ?: return@withLock
        request("DELETE", "/api/token/$id", null, sessionVersion())
        Unit
    }

    private suspend fun checked(version: Long, method: String, path: String, body: JsonObject? = null): JsonObject {
        val response = request(method, path, body, version)
        val text = response.bodyAsText()
        if (!response.status.isSuccess()) throw parseFailure(response.status.value, text)
        val root = Agent567Json.parseToJsonElement(text) as? JsonObject
            ?: throw Agent567Exception.Protocol("无法解析模型授权响应")
        if (root["success"]?.jsonPrimitive?.booleanOrNull == false) throw parseFailure(response.status.value, text)
        return root
    }

    private fun namespace(access: String) = "${fingerprint(serviceIdentity().lowercase())}-${access.length}-${fingerprint(access)}"
    private fun fingerprint(value: String): String {
        var hash = -0x340d631b7bdddcdbL
        value.encodeToByteArray().forEach { hash = (hash xor (it.toLong() and 0xffL)) * 0x100000001b3L }
        return hash.toULong().toString(16)
    }
}
