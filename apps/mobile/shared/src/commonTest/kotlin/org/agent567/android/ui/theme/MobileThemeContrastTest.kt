package org.agent567.android.ui.theme

import androidx.compose.ui.graphics.Color
import org.agent567.android.ui.components.brandIconPalette
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MobileThemeContrastTest {
    @Test fun textAndSemanticActionsRemainReadableOnEveryMobileSurface() {
        for (dark in listOf(false, true)) {
            val scheme = if (dark) DarkScheme else LightScheme
            val extra = mobileExtraColors(dark)
            assertTrue(extra.isDark == dark)
            for (surface in listOf(scheme.background, scheme.surface, extra.chipBackground)) {
                for ((name, ink) in listOf("body" to scheme.onSurface, "secondary" to extra.secondaryText,
                    "conversation" to extra.chatAccent, "image" to extra.imageAccent, "error" to scheme.error)) {
                    assertTrue(contrast(ink, surface) >= 4.5, "dark=$dark $name contrast=${contrast(ink, surface)}")
                }
            }
            assertTrue(contrast(scheme.onPrimary, scheme.primary) >= 4.5)
            assertTrue(contrast(scheme.onErrorContainer, scheme.errorContainer) >= 4.5)
            assertTrue(contrast(scheme.onError, scheme.error) >= 4.5)
        }
    }

    @Test fun brandIconPaletteFollowsLightAndDarkThemeWithHighGlyphContrast() {
        val light = brandIconPalette(dark = false)
        val dark = brandIconPalette(dark = true)
        assertFalse(light.containerColor == dark.containerColor)
        assertFalse(light.glyphColor == dark.glyphColor)
        assertTrue(light.containerColor.red > 0.9f && dark.containerColor.red < 0.2f)
        assertTrue(contrast(light.glyphColor, light.containerColor) >= 12.0)
        assertTrue(contrast(dark.glyphColor, dark.containerColor) >= 12.0)
    }
}

private fun contrast(a: Color, b: Color): Double {
    fun luminance(color: Color): Double {
        fun channel(value: Float): Double = if (value <= 0.04045f) value / 12.92 else ((value + 0.055) / 1.055).pow(2.4)
        return .2126 * channel(color.red) + .7152 * channel(color.green) + .0722 * channel(color.blue)
    }
    val x = luminance(a)
    val y = luminance(b)
    return (max(x, y) + .05) / (min(x, y) + .05)
}
