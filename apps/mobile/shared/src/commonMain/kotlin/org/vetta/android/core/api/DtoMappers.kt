package org.vetta.android.core.api

import org.vetta.android.core.model.AuthSession
import org.vetta.android.core.model.LlmModel
import org.vetta.android.core.model.ModelsCatalog
import org.vetta.android.core.model.ProviderModels
import org.vetta.android.core.model.QuotaWindow
import org.vetta.android.core.model.SubscriptionStatus
import org.vetta.android.core.model.TokenPair
import org.vetta.android.core.model.TokenUsage
import org.vetta.android.core.model.User

internal fun UserDto.toDomain(): User {
    val qUsd = quota.toDouble() / 500000.0
    val effectiveName = nickname.ifBlank { displayName ?: username }
    return User(
        id = id,
        username = username,
        nickname = effectiveName,
        phone = phone,
        email = email,
        avatar = avatar,
        isActive = isActive,
        createdAt = createdAt,
        quota = quota,
        quotaUsd = qUsd,
    )
}

internal fun LoginResponseDto.toSession(): AuthSession {
    val access = accessToken ?: token
    require(!access.isNullOrBlank()) { "login response missing access_token" }
    val refresh = refreshToken?.takeIf { it.isNotBlank() } ?: access
    val effectiveUser = user ?: UserDto(
        id = id,
        username = username,
        displayName = displayName,
        quota = quota,
        role = role,
    )
    return AuthSession(
        accessToken = access,
        refreshToken = refresh,
        user = effectiveUser.toDomain(),
        requiresPassword = requiresPassword,
    )
}

internal fun RefreshResponseDto.toTokenPair(): TokenPair =
    TokenPair(accessToken = accessToken, refreshToken = refreshToken)

internal fun SubscriptionStatusDto.toDomain(): SubscriptionStatus =
    SubscriptionStatus(
        active = active,
        isDefault = isDefault,
        goEnabled = goEnabled,
        tierId = tierId,
        tierName = tierName,
        badgeText = badgeText,
        badgeColor = badgeColor,
        description = description,
        expiresAt = expiresAt,
        windows = windows.map { it.toDomain() },
    )

internal fun QuotaWindowDto.toDomain(): QuotaWindow =
    QuotaWindow(
        kind = kind,
        limit = limit,
        consumed = consumed,
        resetAt = resetAt,
    )

internal fun ModelsCatalogDto.toDomain(): ModelsCatalog {
    val domain = mutableMapOf<String, ProviderModels>()
    for ((providerKey, config) in providers) {
        val models =
            config.models.map { remote ->
                LlmModel(
                    id = remote.id,
                    modelId = remote.modelId ?: remote.id,
                    name = remote.name.ifBlank { remote.id },
                    providerName = providerKey,
                    api = config.api,
                    baseUrl = config.baseUrl,
                    reasoning = remote.reasoning,
                    input = remote.input,
                    contextWindow = remote.contextWindow,
                    maxTokens = remote.maxTokens,
                    multiplier = remote.multiplier,
                    tags = remote.tags,
                    reasoningLevels = remote.reasoningLevels,
                    defaultReasoningLevel = remote.defaultReasoningLevel,
                )
            }
        domain[providerKey] =
            ProviderModels(
                name = providerKey,
                api = config.api,
                baseUrl = config.baseUrl,
                models = models,
            )
    }
    return ModelsCatalog(domain)
}

internal fun ChatUsageDto.toDomain(): TokenUsage =
    TokenUsage(
        promptTokens = promptTokens,
        completionTokens = completionTokens,
        totalTokens = totalTokens,
    )
