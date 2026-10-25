package org.agent567.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.agent567.android.app.ThemeMode

/** Neutral workspace surfaces shared by every mobile screen. */
object Agent567Palette {
    val Black = Color(0xFF191B20)
    val Gray666 = Color(0xFF626873)
    val GrayE5 = Color(0xFFDADDE3)
    val White = Color(0xFFFFFFFF)
    val PageBg = Color(0xFFF5F6F8)
    val CardBorder = Color(0xFFE0E3E8)
    val Success = Color(0xFF1A7F37)
    val Danger = Color(0xFFCF222E)
    val ChipBg = Color(0xFFEDEFF3)
    val DarkPageBg = Color(0xFF111214)
    val DarkSurface = Color(0xFF1A1B1E)
    val DarkElevated = Color(0xFF24262B)
    val DarkBorder = Color(0xFF363940)
}

@Immutable
data class Agent567ExtraColors(
    val pageBackground: Color,
    val secondaryText: Color,
    val border: Color,
    val chipBackground: Color,
    val success: Color,
    val chatAccent: Color = Color(0xFF8A5A0A),
    val imageAccent: Color = Color(0xFF7142B5),
)

val LocalAgent567Extra =
    staticCompositionLocalOf {
        Agent567ExtraColors(
            pageBackground = Agent567Palette.PageBg,
            secondaryText = Agent567Palette.Gray666,
            border = Agent567Palette.CardBorder,
            chipBackground = Agent567Palette.ChipBg,
            success = Agent567Palette.Success,
        )
    }

internal val LightScheme =
    lightColorScheme(
        primary = Agent567Palette.Black,
        onPrimary = Agent567Palette.White,
        primaryContainer = Agent567Palette.GrayE5,
        onPrimaryContainer = Agent567Palette.Black,
        secondary = Agent567Palette.Gray666,
        onSecondary = Agent567Palette.White,
        secondaryContainer = Agent567Palette.ChipBg,
        onSecondaryContainer = Agent567Palette.Black,
        background = Agent567Palette.PageBg,
        onBackground = Agent567Palette.Black,
        surface = Agent567Palette.White,
        surfaceTint = Color.Transparent,
        surfaceContainerLowest = Agent567Palette.White,
        surfaceContainerLow = Agent567Palette.White,
        surfaceContainer = Color(0xFFF0F2F5),
        surfaceContainerHigh = Agent567Palette.ChipBg,
        surfaceContainerHighest = Color(0xFFE5E8ED),
        surfaceDim = Color(0xFFD9DDE3),
        surfaceBright = Agent567Palette.White,
        inverseSurface = Agent567Palette.DarkSurface,
        inverseOnSurface = Agent567Palette.White,
        onSurface = Agent567Palette.Black,
        surfaceVariant = Agent567Palette.ChipBg,
        onSurfaceVariant = Agent567Palette.Gray666,
        outline = Agent567Palette.GrayE5,
        outlineVariant = Agent567Palette.CardBorder,
        tertiary = Color(0xFF8A5A0A),
        onTertiary = Agent567Palette.White,
        errorContainer = Color(0xFFFFE9E9),
        onErrorContainer = Color(0xFF8E1722),
        error = Agent567Palette.Danger,
        onError = Agent567Palette.White,
    )

internal val DarkScheme =
    darkColorScheme(
        primary = Agent567Palette.White,
        onPrimary = Agent567Palette.Black,
        primaryContainer = Color(0xFF30333A),
        onPrimaryContainer = Agent567Palette.White,
        secondary = Color(0xFFADB3BE),
        secondaryContainer = Agent567Palette.DarkElevated,
        onSecondaryContainer = Agent567Palette.White,
        tertiary = Color(0xFFE5BC71),
        onTertiary = Agent567Palette.Black,
        onSecondary = Agent567Palette.Black,
        background = Agent567Palette.DarkPageBg,
        onBackground = Agent567Palette.White,
        surface = Agent567Palette.DarkSurface,
        surfaceTint = Color.Transparent,
        surfaceContainerLowest = Agent567Palette.DarkPageBg,
        surfaceContainerLow = Agent567Palette.DarkSurface,
        surfaceContainer = Agent567Palette.DarkSurface,
        surfaceContainerHigh = Agent567Palette.DarkElevated,
        surfaceContainerHighest = Color(0xFF2E3036),
        surfaceDim = Color(0xFF0C0D0F),
        surfaceBright = Color(0xFF32343B),
        inverseSurface = Agent567Palette.ChipBg,
        inverseOnSurface = Agent567Palette.Black,
        onSurface = Agent567Palette.White,
        surfaceVariant = Agent567Palette.DarkElevated,
        onSurfaceVariant = Color(0xFFADB3BE),
        outline = Color(0xFF484C55),
        outlineVariant = Agent567Palette.DarkBorder,
        errorContainer = Color(0xFF402326),
        onErrorContainer = Color(0xFFFFC6CB),
        error = Color(0xFFFF8A91),
        onError = Agent567Palette.Black,
    )

/** Compact native hierarchy: page 22, toolbar 18, body 14–15, metadata 12. */
private val Agent567Typography =
    Typography(
        headlineLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 28.sp, lineHeight = 36.sp),
        headlineMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 32.sp),
        headlineSmall =
            TextStyle(
                fontWeight = FontWeight.SemiBold,
                fontSize = 22.sp,
                lineHeight = 30.sp,
            ),
        titleLarge =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 18.sp,
                lineHeight = 26.sp,
            ),
        titleMedium =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 16.sp,
                lineHeight = 22.sp,
            ),
        titleSmall =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 15.sp,
                lineHeight = 20.sp,
            ),
        bodyLarge =
            TextStyle(
                fontWeight = FontWeight.Normal,
                fontSize = 15.sp,
                lineHeight = 24.sp,
            ),
        bodyMedium =
            TextStyle(
                fontWeight = FontWeight.Normal,
                fontSize = 14.sp,
                lineHeight = 20.sp,
            ),
        bodySmall =
            TextStyle(
                fontWeight = FontWeight.Normal,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            ),
        labelLarge =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 14.sp,
                lineHeight = 18.sp,
            ),
        labelMedium =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 12.sp,
                lineHeight = 16.sp,
            ),
        labelSmall =
            TextStyle(
                fontWeight = FontWeight.Normal,
                fontSize = 11.sp,
                lineHeight = 14.sp,
            ),
    )

private val Agent567Shapes =
    Shapes(
        extraSmall = RoundedCornerShape(8.dp),
        small = RoundedCornerShape(10.dp),
        medium = RoundedCornerShape(14.dp),
        large = RoundedCornerShape(14.dp),
        extraLarge = RoundedCornerShape(18.dp),
    )

@Composable
fun Agent567Theme(
    themeMode: ThemeMode,
    content: @Composable () -> Unit,
) {
    val dark =
        when (themeMode) {
            ThemeMode.System -> isSystemInDarkTheme()
            ThemeMode.Light -> false
            ThemeMode.Dark -> true
        }
    ApplyMobileSystemBars(dark)
    val extra = mobileExtraColors(dark)
    androidx.compose.runtime.CompositionLocalProvider(LocalAgent567Extra provides extra) {
        MaterialTheme(
            colorScheme = if (dark) DarkScheme else LightScheme,
            typography = Agent567Typography,
            shapes = Agent567Shapes,
            content = content,
        )
    }
}

internal fun mobileExtraColors(dark: Boolean): Agent567ExtraColors =
        if (dark) {
            Agent567ExtraColors(
                pageBackground = Agent567Palette.DarkPageBg,
                secondaryText = Color(0xFFADB3BE),
                border = Agent567Palette.DarkBorder,
                chipBackground = Agent567Palette.DarkElevated,
                success = Color(0xFF7DD8A4),
                chatAccent = Color(0xFFE5BC71),
                imageAccent = Color(0xFFC5A2F5),
            )
        } else {
            Agent567ExtraColors(
                pageBackground = Agent567Palette.PageBg,
                secondaryText = Agent567Palette.Gray666,
                border = Agent567Palette.CardBorder,
                chipBackground = Agent567Palette.ChipBg,
                success = Agent567Palette.Success,
            )
        }

val MaterialTheme.agent567Extra: Agent567ExtraColors
    @Composable
    get() = LocalAgent567Extra.current

@Composable
internal expect fun ApplyMobileSystemBars(dark: Boolean)
