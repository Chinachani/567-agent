package org.agent567.android.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

const val MAX_MODEL_CONTEXT = 10_000_000L
internal const val MODEL_CONTEXT_CACHE_TTL_MS = 12L * 60 * 60 * 1000

fun validModelContext(value: Long?): Long? = value?.takeIf { it in 1024L..MAX_MODEL_CONTEXT }

fun parseModelContextCapacityInput(value: String): Long? {
    val match = Regex("^(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)\\s*(ki|mi|k|m)?$", RegexOption.IGNORE_CASE)
        .matchEntire(value.trim().replace('，', ',')) ?: return null
    val multiplier = when (match.groupValues[2].lowercase()) { "k" -> 1000.0; "m" -> 1000000.0; "ki" -> 1024.0; "mi" -> 1048576.0; else -> 1.0 }
    val result = (match.groupValues[1].replace(",", "").toDoubleOrNull() ?: return null) * multiplier
    return if (result.isFinite() && result % 1.0 == 0.0) validModelContext(result.toLong()) else null
}

data class ModelParameterRange(val min: Double, val max: Double, val minExclusive: Boolean = false, val maxExclusive: Boolean = false)
data class ModelReasoningOption(val type: String, val values: List<String>? = null, val min: Int? = null, val max: Int? = null)
data class ModelReferenceCapabilities(
    val input: List<String>? = null, val output: List<String>? = null,
    val tools: Boolean? = null, val reasoning: Boolean? = null,
    val temperature: Boolean? = null, val topP: Boolean? = null,
    val samplingConstraint: String? = null,
    val temperatureRange: ModelParameterRange? = null, val topPRange: ModelParameterRange? = null,
    val reasoningOptions: List<ModelReasoningOption>? = null,
    val sourceUrl: String, val parameterSourceUrl: String? = null,
)
internal data class BundledModelContext(val capacity: Long?, val maxOutputTokens: Long?, val modelId: String, val sourceUrl: String, val checkedAt: String, val alias: Boolean, val maxInputTokens: Long? = null, val capabilities: ModelReferenceCapabilities? = null)

internal fun modelContextReference(model: LlmModel): BundledModelContext? = bundledModelContexts[model.modelId] ?: bundledModelContexts[model.id]

@Serializable
data class ModelContextMetadata(val capacity: Long? = null, val maxOutputTokens: Long? = null)

@Serializable
internal data class CachedModelContext(val metadata: ModelContextMetadata, val fetchedAt: Long) {
    fun isFresh(now: Long): Boolean = now >= fetchedAt && now - fetchedAt < MODEL_CONTEXT_CACHE_TTL_MS
}

fun parseModelContextMetadata(root: JsonElement): Map<String, ModelContextMetadata> {
    val entries = root as? JsonArray ?: (root as? JsonObject)?.let { it["data"] as? JsonArray ?: it["models"] as? JsonArray } ?: return emptyMap()
    return entries.take(10_000).mapNotNull { entry ->
        val raw = entry as? JsonObject ?: return@mapNotNull null
        val id = listOf("id", "name", "model").firstNotNullOfOrNull { (raw[it] as? JsonPrimitive)?.content?.takeIf { value -> value.isNotBlank() && value.length <= 1024 } } ?: return@mapNotNull null
        val info = raw["model_info"] as? JsonObject
        val top = raw["top_provider"] as? JsonObject
        val limit = raw["limit"] as? JsonObject
        val capacity = listOf(raw["context_window"], raw["contextWindow"], raw["context_length"], raw["max_context_length"],
            raw["max_input_tokens"], raw["inputTokenLimit"], info?.get("max_input_tokens"), top?.get("context_length"), limit?.get("context"))
            .firstNotNullOfOrNull { validModelContext((it as? JsonPrimitive)?.longOrNull) }
        val output = listOf(raw["max_output_tokens"], raw["outputTokenLimit"], info?.get("max_output_tokens"), limit?.get("output"))
            .firstNotNullOfOrNull { (it as? JsonPrimitive)?.longOrNull?.takeIf { value -> value in 1L..MAX_MODEL_CONTEXT } }
        if (capacity == null && output == null) null else id to ModelContextMetadata(capacity, output)
    }.toMap()
}

fun resolveModelContext(model: LlmModel, metadata: ModelContextMetadata?, manual: Long?): LlmModel {
    val override = validModelContext(manual)
    val api = validModelContext(metadata?.capacity)
    val catalog = modelContextReference(model)
    return model.copy(
        contextWindow = override ?: api ?: catalog?.capacity,
        contextWindowSource = when { override != null -> "manual"; api != null -> "api"; catalog?.capacity != null -> "catalog"; else -> "unknown" },
        maxTokens = metadata?.maxOutputTokens ?: model.maxTokens,
    )
}
