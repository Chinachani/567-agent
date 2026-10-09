package org.agent567.android.core.net

import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.isSuccess
import kotlinx.serialization.serializer
import org.agent567.android.core.api.ApiEnvelope
import org.agent567.android.core.api.OpenAiErrorBody
import org.agent567.android.core.error.Agent567Exception

internal suspend inline fun <reified T> HttpResponse.parseEnvelope(): T {
    val text = bodyAsText()
    if (!status.isSuccess()) {
        throw parseFailure(status.value, text)
    }
    val envelope =
        runCatching {
            Agent567Json.decodeFromString(ApiEnvelope.serializer(serializer<T>()), text)
        }.getOrElse { cause ->
            throw Agent567Exception.Protocol("无法解析 API 响应", cause)
        }
    if (!envelope.isSuccessful) {
        val errCode = envelope.code ?: -1
        if (status.value == 401 || errCode in UNAUTHORIZED_CODES) {
            throw Agent567Exception.Unauthorized(envelope.message.ifBlank { "未授权" }, errCode)
        }
        throw Agent567Exception.Api(
            httpStatus = status.value,
            code = errCode,
            message = envelope.message.ifBlank { "请求失败" },
            rawBody = text,
        )
    }
    val data = envelope.data
    if (data == null) {
        if (null is T) {
            @Suppress("UNCHECKED_CAST")
            return null as T
        }
        throw Agent567Exception.Protocol("API 响应 data 为空")
    }
    return data
}

internal suspend fun HttpResponse.ensureSuccessOrThrow() {
    if (status.isSuccess()) return
    throw parseFailure(status.value, bodyAsText())
}

internal fun parseFailure(httpStatus: Int, body: String): Agent567Exception {
    // 优先业务信封（忽略 data 形状）
    runCatching {
        val element = Agent567Json.parseToJsonElement(body)
        val obj = element as? kotlinx.serialization.json.JsonObject
        val code = (obj?.get("code") as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull()
        val success = (obj?.get("success") as? kotlinx.serialization.json.JsonPrimitive)?.content?.toBooleanStrictOrNull()
        val message =
            (obj?.get("message") as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty()
        if (success == false || (code != null && code != 0)) {
            val errCode = code ?: -1
            if (httpStatus == 401 || errCode in UNAUTHORIZED_CODES) {
                return Agent567Exception.Unauthorized(
                    message = message.ifBlank { "未授权" },
                    code = errCode,
                )
            }
            return Agent567Exception.Api(
                httpStatus = httpStatus,
                code = code,
                message = message.ifBlank { "HTTP $httpStatus" },
                rawBody = body,
            )
        }
    }

    // 网关 OpenAI 错误体
    runCatching {
        Agent567Json.decodeFromString(OpenAiErrorBody.serializer(), body)
    }.getOrNull()?.let { openai ->
        val message =
            openai.error?.message
                ?: openai.message
                ?: "HTTP $httpStatus"
        if (httpStatus == 401 && (message.contains("Invalid token", ignoreCase = true) || message.contains("permission", ignoreCase = true) || message.contains("token", ignoreCase = true))) {
            return Agent567Exception.Api(
                httpStatus = 401,
                code = openai.error?.code,
                message = "当前分组下该模型鉴权失败或无权限，请更换模型或分组重试",
                rawBody = body,
            )
        }
        if (httpStatus == 401) {
            return Agent567Exception.Unauthorized(message, openai.error?.code)
        }
        return Agent567Exception.Api(
            httpStatus = httpStatus,
            code = openai.error?.code,
            message = message,
            rawBody = body,
        )
    }

    if (httpStatus == 401) {
        if (body.contains("Invalid token", ignoreCase = true) || body.contains("permission", ignoreCase = true)) {
            return Agent567Exception.Api(
                httpStatus = 401,
                code = null,
                message = "当前分组下该模型鉴权失败或无权限，请更换模型或分组重试",
                rawBody = body,
            )
        }
        return Agent567Exception.Unauthorized(body.ifBlank { "未授权" })
    }
    return Agent567Exception.Api(
        httpStatus = httpStatus,
        code = null,
        message = body.ifBlank { "HTTP $httpStatus" },
        rawBody = body,
    )
}

internal val UNAUTHORIZED_CODES =
    setOf(
        40100,
        40101,
        40102,
        40103,
        40105,
        40106,
        40107,
    )
