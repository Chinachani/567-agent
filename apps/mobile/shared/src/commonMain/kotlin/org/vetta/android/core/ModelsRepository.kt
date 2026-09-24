package org.vetta.android.core

import org.vetta.android.core.api.ApiGroupInfoDto
import org.vetta.android.core.api.VettaApi
import org.vetta.android.core.model.LlmModel
import org.vetta.android.core.model.ModelsCatalog

class ModelsRepository internal constructor(
    private val api: VettaApi,
) {
    suspend fun fetchGoModelsCatalog(group: String? = null): ModelsCatalog = api.goModels(group)

    suspend fun listGoModels(group: String? = null): List<LlmModel> = api.goModels(group).goModels()

    suspend fun listAllModels(group: String? = null): List<LlmModel> = api.goModels(group).allModels()

    suspend fun getAvailableGroups(): Map<String, ApiGroupInfoDto> = api.getAvailableGroups()

    suspend fun cleanupGroupToken(group: String?) = api.cleanupGroupToken(group)

    suspend fun fetchGroupImageModels(group: String?): List<String> = api.fetchGroupImageModels(group)

    suspend fun downloadBytes(url: String): ByteArray = api.downloadBytes(url)

    suspend fun downloadImageBytesDirect(url: String): ByteArray {
        return kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            conn.requestMethod = "GET"
            conn.inputStream.use { it.readBytes() }
        }
    }

    suspend fun generateImage(
        prompt: String,
        model: String,
        groupName: String? = null,
        referenceImages: List<String> = emptyList(),
    ) = api.generateImage(prompt = prompt, model = model, groupName = groupName, referenceImages = referenceImages)
}
