package org.agent567.android.data.session

import java.io.File
import java.util.Base64
import kotlinx.serialization.json.*
import org.agent567.android.core.net.Agent567Json
import kotlin.test.*

class MigrationCryptoInteropHostTest {
    @Test fun readsPeerArchivesAndExportsAnActualAndroidCryptoVector() {
        val root = generateSequence<File>(File(requireNotNull(System.getProperty("user.dir"))).absoluteFile) { it.parentFile }
            .first { File(it, "test-fixtures/session-migration/v1.json").isFile }
        val fixture = Agent567Json.parseToJsonElement(File(root, "test-fixtures/session-migration/v1.json").readText()).jsonObject
        val password = fixture.getValue("passphrase").jsonPrimitive.content
        val plaintext = fixture.getValue("plaintext").jsonPrimitive.content
        for (item in fixture.getValue("archives").jsonArray) {
            val bytes = Base64.getDecoder().decode(item.jsonObject.getValue("base64").jsonPrimitive.content)
            assertEquals(plaintext, decryptMigrationPayload(bytes,password).decodeToString())
            assertFailsWith<IllegalArgumentException> { decryptMigrationPayload(bytes,"incorrect-password") }
            val damaged = bytes.copyOf().apply { this[lastIndex] = (this[lastIndex].toInt() xor 1).toByte() }
            assertFailsWith<IllegalArgumentException> { decryptMigrationPayload(damaged,password) }
        }
        val encrypted = encryptMigrationPayload(plaintext.encodeToByteArray(),password)
        assertEquals(plaintext, decryptMigrationPayload(encrypted,password).decodeToString())
        // Public synthetic fixture for the Desktop side of the local interop run.
        val output = File(root,"apps/mobile/shared/build/test-vectors/android-migration-v1.json")
        output.parentFile.mkdirs()
        output.writeText(buildJsonObject {
            put("producer","android-jce")
            put("base64",Base64.getEncoder().encodeToString(encrypted))
        }.toString())
    }
}
