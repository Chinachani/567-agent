package org.agent567.android.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.agent567.android.ui.theme.Agent567Palette
import org.agent567.android.ui.theme.agent567Extra

private const val BRAND_GLYPH_PATH_DATA =
    "M 244 316 L 152 316 A 20 20 0 0 0 132 336 L 132 644 A 20 20 0 0 0 152 664 L 244 664 " +
        "A 8 8 0 0 0 252 656 L 252 616 A 8 8 0 0 0 244 608 L 186 608 L 186 372 L 244 372 " +
        "A 8 8 0 0 0 252 364 L 252 324 A 8 8 0 0 0 244 316 Z " +
        "M 780 316 L 872 316 A 20 20 0 0 1 892 336 L 892 644 A 20 20 0 0 1 872 664 L 780 664 " +
        "A 8 8 0 0 1 772 656 L 772 616 A 8 8 0 0 1 780 608 L 838 608 L 838 372 L 780 372 " +
        "A 8 8 0 0 1 772 364 L 772 324 A 8 8 0 0 1 780 316 Z " +
        "M 282 382 L 402 382 A 10 10 0 0 1 412 392 L 412 420 A 10 10 0 0 1 402 430 L 322 430 " +
        "L 322 466 L 388 466 A 24 24 0 0 1 412 490 L 412 574 A 24 24 0 0 1 388 598 L 282 598 " +
        "A 12 12 0 0 1 270 586 L 270 540 A 10 10 0 0 1 280 530 L 310 530 A 10 10 0 0 1 320 540 " +
        "L 320 554 L 364 554 L 364 510 L 282 510 A 10 10 0 0 1 272 500 L 272 392 " +
        "A 10 10 0 0 1 282 382 Z " +
        "M 467 382 L 573 382 A 10 10 0 0 1 583 392 L 583 420 A 10 10 0 0 1 573 430 L 491 430 " +
        "L 491 470 L 557 470 A 26 26 0 0 1 583 496 L 583 572 A 26 26 0 0 1 557 598 L 467 598 " +
        "A 26 26 0 0 1 441 572 L 441 408 A 26 26 0 0 1 467 382 Z " +
        "M 531 514 A 4 4 0 0 0 527 510 L 497 510 A 4 4 0 0 0 493 514 L 493 550 " +
        "A 4 4 0 0 0 497 554 L 527 554 A 4 4 0 0 0 531 550 Z " +
        "M 622 382 L 744 382 A 10 10 0 0 1 754 392 L 754 424 A 10 10 0 0 1 748 432 L 680 590 " +
        "A 10 10 0 0 1 670 598 L 628 598 A 10 10 0 0 1 618 586 L 680 430 L 622 430 " +
        "A 10 10 0 0 1 612 420 L 612 392 A 10 10 0 0 1 622 382 Z"

@Immutable
data class BrandIconPalette(
    val containerColor: Color,
    val glyphColor: Color,
    val promptColor: Color,
    val borderColor: Color,
)

/** Theme-aligned brand badge colors matching the desktop light and dark brand icons. */
fun brandIconPalette(dark: Boolean): BrandIconPalette =
    if (dark) {
        BrandIconPalette(
            containerColor = Color(0xFF121316),
            glyphColor = Color(0xFFF4F5F7),
            promptColor = Color(0xFFF59E0B),
            borderColor = Agent567Palette.DarkBorder,
        )
    } else {
        BrandIconPalette(
            containerColor = Color(0xFFFAFAFB),
            glyphColor = Color(0xFF121316),
            promptColor = Color(0xFFF59E0B),
            borderColor = Agent567Palette.CardBorder,
        )
    }

/** In-app vector brand mark that adapts to the active light or dark Agent567 theme. */
@Composable
fun Agent567BrandIcon(
    modifier: Modifier = Modifier,
    contentDescription: String? = null,
    cornerShape: Shape = RoundedCornerShape(percent = 22),
) {
    val palette = brandIconPalette(MaterialTheme.agent567Extra.isDark)
    val glyphPath = remember {
        PathParser().parsePathString(BRAND_GLYPH_PATH_DATA).toPath().apply {
            fillType = PathFillType.EvenOdd
        }
    }
    val semanticsModifier =
        if (contentDescription != null) {
            Modifier.semantics {
                this.contentDescription = contentDescription
                this.role = Role.Image
            }
        } else {
            Modifier
        }

    Surface(
        modifier = modifier.then(semanticsModifier),
        shape = cornerShape,
        color = palette.containerColor,
        border = BorderStroke(1.dp, palette.borderColor),
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val glyphScale = minOf(size.width, size.height) * 1.16f / 1024f
            translate(left = center.x - 512f * glyphScale, top = center.y - 512f * glyphScale) {
                scale(scale = glyphScale, pivot = Offset.Zero) {
                    drawPath(path = glyphPath, color = palette.glyphColor)
                    drawRoundRect(
                        color = palette.promptColor,
                        topLeft = Offset(445f, 664f),
                        size = Size(90f, 24f),
                        cornerRadius = CornerRadius(12f, 12f),
                    )
                    drawCircle(
                        color = palette.promptColor,
                        radius = 12f,
                        center = Offset(567f, 676f),
                    )
                }
            }
        }
    }
}
