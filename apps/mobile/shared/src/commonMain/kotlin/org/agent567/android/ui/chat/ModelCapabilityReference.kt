package org.agent567.android.ui.chat

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalUriHandler
import org.agent567.android.core.model.ModelParameterRange
import org.agent567.android.core.model.ModelReferenceCapabilities
import org.agent567.android.ui.i18n.Str

@Composable
internal fun ModelCapabilityReference(capabilities: ModelReferenceCapabilities?, maxInputTokens: Long?) {
    val uriHandler = LocalUriHandler.current
    fun supported(value: Boolean?): String = when (value) {
        true -> Str.modelCapabilitySupported
        false -> Str.modelCapabilityUnsupported
        null -> Str.contextCapacityUnknown
    }
    fun range(value: ModelParameterRange?): String = value?.let {
        "${if (it.minExclusive) "(" else "["}${it.min}, ${it.max}${if (it.maxExclusive) ")" else "]"}"
    }.orEmpty()
    fun modalities(values: List<String>?): String = values?.joinToString(" / ") {
        when (it) { "text" -> Str.modelCapabilityText; "image" -> Str.modelCapabilityImage; "audio" -> Str.modelCapabilityAudio; "video" -> Str.modelCapabilityVideo; "pdf" -> "PDF"; else -> it }
    }?.takeIf { it.isNotEmpty() } ?: Str.contextCapacityUnknown
    val thinking = capabilities?.reasoningOptions?.joinToString("; ") {
        when (it.type) {
            "effort" -> it.values?.joinToString(" / ") ?: Str.contextCapacityUnknown
            "toggle" -> Str.modelCapabilityToggle
            "fixed" -> Str.modelCapabilityFixed
            "budget_tokens" -> "${Str.modelCapabilityBudget}: ${it.min ?: "?"} ～ ${it.max ?: "?"}"
            else -> Str.contextCapacityUnknown
        }
    } ?: Str.contextCapacityUnknown
    val fields = listOf(
        Str.modelCapabilityMaxInput to (maxInputTokens?.toString() ?: Str.contextCapacityUnknown),
        Str.modelCapabilityInput to modalities(capabilities?.input),
        Str.modelCapabilityOutput to modalities(capabilities?.output),
        Str.modelCapabilityTools to supported(capabilities?.tools),
        Str.modelCapabilityReasoning to "${supported(capabilities?.reasoning)} · $thinking",
        Str.modelCapabilityTemperature to "${supported(capabilities?.temperature)} ${range(capabilities?.temperatureRange)}",
        Str.modelCapabilityTopP to "${supported(capabilities?.topP)} ${range(capabilities?.topPRange)}",
    )
    fields.forEach { (label, value) -> Text("$label: $value", style = MaterialTheme.typography.bodySmall) }
    Text(Str.modelCapabilityHint, style = MaterialTheme.typography.bodySmall)
    when (capabilities?.samplingConstraint) {
        "reasoningNoneOnly" -> Text(Str.modelCapabilityNoneOnly, style = MaterialTheme.typography.bodySmall)
        "deepseekModes" -> Text(Str.modelCapabilityDeepSeek, style = MaterialTheme.typography.bodySmall)
    }
    listOf(Str.modelCapabilitySource to capabilities?.sourceUrl, Str.modelCapabilityParameters to capabilities?.parameterSourceUrl).forEach { (label, url) ->
        if (url?.startsWith("https://") == true) TextButton(onClick = { runCatching { uriHandler.openUri(url) } }) { Text(label) }
    }
}
