package org.agent567.android.core.api

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.runBlocking
import org.agent567.android.core.Agent567Client
import org.agent567.android.core.Agent567Config
import org.agent567.android.core.auth.InMemoryTokenStore
import kotlin.test.*

class ImageGenerationHostTest {
    private fun imageClient(response: String, status: Int = 200, contentTypes: MutableList<String> = mutableListOf(), run: suspend (Agent567Client, MutableList<Pair<String, String>>) -> Unit) = runBlocking {
        val requests = mutableListOf<Pair<String, String>>()
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { request ->
            contentTypes += request.requestHeaders.getFirst("Content-Type").orEmpty()
            requests += request.requestURI.path to request.requestBody.readBytes().toString(Charsets.ISO_8859_1)
            val bytes = response.toByteArray()
            request.responseHeaders.add("Content-Type", "application/json")
            request.sendResponseHeaders(status, bytes.size.toLong())
            request.responseBody.use { it.write(bytes) }
        }
        server.start()
        val client = Agent567Client.create(Agent567Config("http://127.0.0.1:${server.address.port}"), InMemoryTokenStore("sk-test", "sk-test"))
        try { run(client, requests) } finally { client.close(); server.stop(0) }
    }

    @Test fun editingDedicatedImageModelUploadsReferenceInsteadOfGeneratingWithoutIt() = imageClient("""{"data":[{"b64_json":"$PNG"}]}""") { client, requests ->
        val result = client.models.generateImage("change time", "gpt-image-2", referenceImages = listOf("data:image/png;base64,$PNG"))
        assertEquals(listOf("/v1/images/edits"), requests.map { it.first })
        assertTrue(requests.single().second.contains("filename=\"reference-0.png\""))
        assertTrue(requests.single().second.contains("change time"))
        assertEquals(PNG, result.b64Json)
    }

    @Test fun editingUsesMultipartContentTypeWithTheActualBoundary() {
        val types = mutableListOf<String>()
        imageClient("""{"data":[{"b64_json":"$PNG"}]}""", contentTypes = types) { client, requests ->
            client.models.generateImage("edit", "gpt-image-2", referenceImages = listOf(PNG))
            val contentType = types.single()
            assertTrue(contentType.startsWith("multipart/form-data;"), contentType)
            val boundary = contentType.substringAfter("boundary=").trim('"')
            assertTrue(requests.single().second.startsWith("--$boundary\r\n"))
        }
    }

    @Test fun textOnlySuccessfulResponseDoesNotTriggerAnotherBillableRequest() = imageClient("""{"choices":[{"message":{"content":"Edited: [download](https://example.test/report)"}}]}""") { client, requests ->
        val result = client.models.generateImage("draw", "gpt-image-2")
        assertNull(result.url)
        assertNull(result.b64Json)
        assertEquals(1, requests.size)
    }

    @Test fun chatImageContentDataUrlIsReadAsAnImage() = imageClient("""{"choices":[{"message":{"content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,$PNG"}}]}}]}""") { client, requests ->
        val result = client.models.generateImage("draw", "gemini-image")
        assertEquals(PNG, result.b64Json)
        assertEquals(1, requests.size)
    }

    @Test fun geminiDrawingAndEditingExplicitlyRequestImageOutput() = imageClient("""{"choices":[{"message":{"images":[{"image_url":{"url":"data:image/png;base64,$PNG"}}]}}]}""") { client, requests ->
        for (references in listOf(emptyList(), listOf("data:image/png;base64,$PNG"))) {
            val result = client.models.generateImage("draw or edit", "gemini-3.1-flash-image", referenceImages = references)
            val request = kotlinx.serialization.json.Json.parseToJsonElement(requests.last().second) as kotlinx.serialization.json.JsonObject
            assertEquals(kotlinx.serialization.json.Json.parseToJsonElement("""["text","image"]"""), request["modalities"])
            assertEquals(PNG, assertNotNull(resolveGeneratedImage(result) { error("No download") }).base64)
        }
        assertEquals(listOf("/v1/chat/completions", "/v1/chat/completions"), requests.map { it.first })
    }

    @Test fun markdownImagePixelsAreNotReturnedAsProse() {
        val markdown = "Caption\n\n![generated](data:image/png;base64,$PNG)\n\nAfter"
        val content = kotlinx.serialization.json.JsonPrimitive(markdown).toString()
        imageClient("""{"choices":[{"message":{"content":$content}}]}""") { client, requests ->
            val result = client.models.generateImage("draw", "gemini-image")
            assertEquals(PNG, result.b64Json)
            assertFalse(result.textContent.orEmpty().contains("data:image/"))
            assertTrue(result.textContent.orEmpty().contains("Caption"))
            assertTrue(result.textContent.orEmpty().contains("After"))
            assertEquals(1, requests.size)
        }
    }

    @Test fun geminiEditPreservesTheActualReferenceMimeType() = imageClient("""{"data":[{"b64_json":"$PNG"}]}""") { client, requests ->
        val jpeg = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AYf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/AYf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z"
        client.models.generateImage("change time", "gemini-image", referenceImages = listOf(jpeg))
        assertEquals(listOf("/v1/chat/completions"), requests.map { it.first })
        assertTrue(requests.single().second.contains("data:image/jpeg;base64,$jpeg"))
        assertFalse(requests.single().second.contains("data:image/png;base64,$jpeg"))
    }

    @Test fun markdownImageWithAngleDestinationAndTitleIsSavedWithoutDuplicatingItsPixels() {
        val markdown = "Before\n\n![generated [image]](<data:image/png;base64,$PNG> \"preview\")\n\nAfter"
        val content = kotlinx.serialization.json.JsonPrimitive(markdown)
        imageClient("""{"choices":[{"message":{"content":$content}}]}""") { client, requests ->
            val result = client.models.generateImage("draw", "gemini-image")
            assertEquals(PNG, result.b64Json)
            assertEquals(PNG, assertNotNull(resolveGeneratedImage(result) { error("No download") }).base64)
            assertFalse(result.textContent.orEmpty().contains("data:image/"))
            assertTrue(result.textContent.orEmpty().contains("Before"))
            assertTrue(result.textContent.orEmpty().contains("After"))
            assertEquals(1, requests.size)
        }
    }

    @Test fun actualMarkdownImageIsExtractedButItsCodeExampleAndOtherLinksArePreserved() {
        val target = "https://example.test/result.png"
        val code = "`![example]($target)`"
        val markdown = "$code\n\n![generated](<$target> \"preview\")\n\n[site](https://example.test)"
        val content = kotlinx.serialization.json.JsonPrimitive(markdown)
        imageClient("""{"choices":[{"message":{"content":$content}}]}""") { client, _ ->
            val result = client.models.generateImage("draw", "gemini-image")
            assertEquals(target, result.url)
            assertEquals("$code\n\n\n\n[site](https://example.test)", result.textContent)
        }
    }

    @Test fun markdownCodeExamplesNeverCountAsReturnedImages() {
        for (markdown in listOf("`![example](data:image/png;base64,$PNG)`", "```markdown\n![example](https://example.test/result.png)\n```")) {
            val content = kotlinx.serialization.json.JsonPrimitive(markdown)
            imageClient("""{"choices":[{"message":{"content":$content}}]}""") { client, requests ->
                val result = client.models.generateImage("draw", "gemini-image")
                assertNull(result.b64Json)
                assertNull(result.url)
                assertEquals(markdown, result.textContent)
                assertEquals(1, requests.size)
            }
        }
    }

    @Test fun wrappedAndUrlSafeBase64KeepTheSameImageValidation() = runBlocking {
        val wrapped = PNG.chunked(20).joinToString("\r\n")
        for (data in listOf(wrapped, PNG.replace('+', '-').replace('/', '_'))) {
            val result = assertNotNull(resolveGeneratedImage(GeneratedImageResult(b64Json = data)) { error("No download") })
            assertEquals(PNG, result.base64)
            assertEquals("image/png", result.mimeType)
        }
    }

    @Test fun geminiRejectsInvalidReferenceDataBeforeSendingARequest() = imageClient("""{"data":[{"b64_json":"$PNG"}]}""") { client, requests ->
        assertTrue(runCatching { client.models.generateImage("edit", "gemini-image", referenceImages = listOf("not base64")) }.isFailure)
        assertTrue(requests.isEmpty())
    }

    @Test fun nullPrimaryImageFieldDoesNotHideAValidAlternative() = imageClient("""{"data":[{"b64_json":null,"image_base64":"$PNG"}]}""") { client, _ ->
        assertEquals(PNG, client.models.generateImage("draw", "gpt-image-2").b64Json)
    }

    @Test fun multipleImagePartsKeepTheFirstImageResult() = imageClient("""{"candidates":[{"content":{"parts":[{"inlineData":{"data":"$PNG","mimeType":"image/png"}},{"inlineData":{"data":"invalid-data","mimeType":"image/png"}}]}}]}""") { client, _ ->
        assertEquals(PNG, client.models.generateImage("draw", "gemini-image").b64Json)
    }

    @Test fun explicitImagesArrayAcceptsUrlStringsWithoutAcceptingProseDownloadLinks() = imageClient("""{"choices":[{"message":{"content":"[download](https://example.test/report)","images":["https://example.test/result.png"]}}]}""") { client, _ ->
        assertEquals("https://example.test/result.png", client.models.generateImage("draw", "gemini-image").url)
    }

    @Test fun nullInlineDataDoesNotHideSnakeCaseImageData() = imageClient("""{"candidates":[{"content":{"parts":[{"inlineData":null,"inline_data":{"data":"$PNG","mime_type":"image/png"}}]}}]}""") { client, _ ->
        assertEquals(PNG, client.models.generateImage("draw", "gemini-image").b64Json)
    }

    @Test fun malformedOrNonImageBytesAreNotAcceptedAsSavedImages() = runBlocking {
        assertNull(resolveGeneratedImage(GeneratedImageResult(b64Json = "not base64")) { error("No download") })
        assertNull(resolveGeneratedImage(GeneratedImageResult(url = "https://example.test/error")) { "<html>Not an image</html>".toByteArray() })
        val result = assertNotNull(resolveGeneratedImage(GeneratedImageResult(b64Json = PNG)) { error("No download") })
        assertEquals("image/png", result.mimeType)
        assertEquals(PNG, result.base64)
    }

    @Test fun generatedImagesUseTheSameSizeLimitAsDurableChatStorage() = runBlocking {
        val signature = kotlin.io.encoding.Base64.decode(PNG)
        val tooLarge = ByteArray(org.agent567.android.domain.session.MAX_MESSAGE_IMAGE_BYTES + 1)
        signature.copyInto(tooLarge)
        assertNull(resolveGeneratedImage(GeneratedImageResult(url = "https://example.test/large.png")) { tooLarge })
    }

    @Test fun rejectedImageProtocolDoesNotFallBackToAnotherBillableEndpoint() = imageClient("""{"error":{"message":"unsupported image protocol"}}""", status = 400) { client, requests ->
        assertTrue(runCatching { client.models.generateImage("draw", "gpt-image-2") }.isFailure)
        assertEquals(listOf("/v1/images/generations"), requests.map { it.first })
    }

    companion object {
        const val PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
    }
}
