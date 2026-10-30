package org.agent567.android.core

import kotlinx.coroutines.ensureActive
import org.agent567.android.core.api.ApiGroupInfoDto
import org.agent567.android.core.api.Agent567Api
import org.agent567.android.core.model.LlmModel
import org.agent567.android.core.model.ModelsCatalog
import org.agent567.android.core.model.MAX_IMAGE_PAYLOAD_BYTES

class ModelsRepository internal constructor(
    private val api: Agent567Api,
) {
    suspend fun fetchGoModelsCatalog(group: String? = null): ModelsCatalog = api.goModels(group)

    suspend fun listGoModels(group: String? = null): List<LlmModel> = api.goModels(group).goModels()

    suspend fun listAllModels(group: String? = null): List<LlmModel> = api.goModels(group).allModels()

    fun resolveContext(model: LlmModel, group: String?, useManual: Boolean = true): LlmModel = api.resolveContext(model, group, useManual)

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
            try {
                check(conn.responseCode in 200..299) { "Image download failed (HTTP ${conn.responseCode})" }
                require(conn.contentLengthLong <= MAX_IMAGE_PAYLOAD_BYTES) { "Image is too large" }
                conn.inputStream.use {
                    val output = java.io.ByteArrayOutputStream()
                    val chunk = ByteArray(8192)
                    while (true) {
                        kotlinx.coroutines.currentCoroutineContext().ensureActive()
                        val count = it.read(chunk)
                        if (count < 0) break
                        require(output.size() + count <= MAX_IMAGE_PAYLOAD_BYTES) { "Image is too large" }
                        output.write(chunk, 0, count)
                    }
                    output.toByteArray()
                }
            } finally { conn.disconnect() }
        }
    }

    suspend fun generateImage(
        prompt: String,
        model: String,
        groupName: String? = null,
        referenceImages: List<String> = emptyList(),
    ) = api.generateImage(prompt = prompt, model = model, groupName = groupName, referenceImages = referenceImages)
    suspend fun checkAppUpdate() = api.checkAppUpdate()
}
