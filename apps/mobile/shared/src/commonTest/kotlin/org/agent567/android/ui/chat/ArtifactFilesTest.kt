package org.agent567.android.ui.chat

import org.intellij.markdown.MarkdownElementTypes
import org.intellij.markdown.ast.ASTNode
import org.intellij.markdown.flavours.gfm.GFMFlavourDescriptor
import org.intellij.markdown.parser.MarkdownParser
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ArtifactFilesTest {
    private fun list(source: String): ASTNode {
        val root = MarkdownParser(GFMFlavourDescriptor()).buildMarkdownTreeFromString(source)
        return root.children.single { it.type == MarkdownElementTypes.UNORDERED_LIST }
    }
    @Test fun keepsEveryFilePathAndName() {
        val source = (1..15).joinToString("\n") { "- [image$it](/output/image$it.jpg)" }
        val files = artifactFiles(source, list(source))!!
        assertEquals(15, files.size)
        assertEquals("image15.jpg", files.last().name)
        assertEquals("/output/image15.jpg", files.last().path)
    }
    @Test fun leavesMixedAndWebListsUnchanged() {
        for (source in listOf("- [a](/a.jpg) with explanation\n- [b](/b.jpg)", "- [a](https://example.test/a.jpg)\n- ordinary text", "- [a](/a.jpg)\n  - nested item")) {
            assertNull(artifactFiles(source, list(source)))
        }
    }
    @Test fun supportsRelativeWindowsAndSpacedPaths() {
        val source = "- [file](<C:/Output/my file.pdf>)\n- [relative](./result.csv)"
        assertEquals(listOf("C:/Output/my file.pdf", "./result.csv"), artifactFiles(source, list(source))!!.map { it.path })
    }
}
