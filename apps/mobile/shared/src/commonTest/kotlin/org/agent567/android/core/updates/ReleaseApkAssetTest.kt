package org.agent567.android.core.updates

import kotlinx.serialization.json.*
import kotlin.test.*

class ReleaseApkAssetTest {
    private val digest = "a".repeat(64)
    private fun asset(url: String = "https://github.com/Chinachani/567-agent/releases/download/v9.0.0/567-agent-9.0.0.apk", name: String = "567-agent-9.0.0.apk", sha: String = "sha256:$digest", size: Long = 1000) = buildJsonObject {
        put("name", name); put("browser_download_url", url); put("size", size); put("digest", sha)
    }

    @Test fun officialAssetCarriesTheSizeAndDigestThatAMirrorCannotReplace() {
        val result = releaseApkAsset(JsonArray(listOf(asset())))!!
        assertEquals(1000L, result.size)
        assertEquals(digest, result.sha256)
        assertTrue(result.url.startsWith("https://github.com/Chinachani/567-agent/"))
    }

    @Test fun foreignRepositoriesCredentialsAndDebugPackagesAreNotOfferedAsProductionUpdates() {
        for (candidate in listOf(
            asset(url = "https://github.com/another/repo/releases/download/v9/file.apk"),
            asset(url = "https://user:secret@github.com/Chinachani/567-agent/releases/download/v9/file.apk"),
            asset(name = "567-agent-9.0.0-debugTest.apk"),
        )) assertNull(releaseApkAsset(JsonArray(listOf(candidate))))
    }

    @Test fun oldOrIncompleteMetadataKeepsTheReleaseLinkWithoutPretendingToHaveIntegrityData() {
        val result = releaseApkAsset(JsonArray(listOf(asset(sha = "", size = -1))))!!
        assertNull(result.size)
        assertNull(result.sha256)
    }
}
