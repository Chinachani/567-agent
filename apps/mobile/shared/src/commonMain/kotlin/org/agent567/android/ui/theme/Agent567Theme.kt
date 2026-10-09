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

/** 设计规范色板（设计图） */
object Agent567Palette {
    val Black = Color(0xFF000000)
    val Gray666 = Color(0xFF666666)
    val GrayE5 = Color(0xFFE5E5E5)
    val White = Color(0xFFFFFFFF)
    val PageBg = Color(0xFFF7F7F8)
    val CardBorder = Color(0xFFE8E8EA)
    val Success = Color(0xFF1A7F37)
    val Danger = Color(0xFFCF222E)
    val ChipBg = Color(0xFFF0F0F2)
    val DarkPageBg = Color(0xFF0A0B10)
    val DarkSurface = Color(0xFF12131A)
    val DarkElevated = Color(0xFF1B1D27)
    val DarkBorder = Color(0x24FFFFFF)
}

@Immutable
data class Agent567ExtraColors(
    val pageBackground: Color,
    val secondaryText: Color,
    val border: Color,
    val chipBackground: Color,
    val success: Color,
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

private val LightScheme =
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
        onSurface = Agent567Palette.Black,
        surfaceVariant = Agent567Palette.ChipBg,
        onSurfaceVariant = Agent567Palette.Gray666,
        outline = Agent567Palette.GrayE5,
        outlineVariant = Agent567Palette.CardBorder,
        error = Agent567Palette.Danger,
        onError = Agent567Palette.White,
    )

private val DarkScheme =
    darkColorScheme(
        primary = Agent567Palette.White,
        onPrimary = Agent567Palette.Black,
        primaryContainer = Color(0xFF2C2C2E),
        onPrimaryContainer = Agent567Palette.White,
        secondary = Color(0xFFAEAEB2),
        onSecondary = Agent567Palette.Black,
        background = Agent567Palette.DarkPageBg,
        onBackground = Agent567Palette.White,
        surface = Agent567Palette.DarkSurface,
        onSurface = Agent567Palette.White,
        surfaceVariant = Agent567Palette.DarkElevated,
        onSurfaceVariant = Color(0xFFAEAEB2),
        outline = Color(0xFF343744),
        outlineVariant = Agent567Palette.DarkBorder,
        error = Color(0xFFFF453A),
        onError = Agent567Palette.White,
    )

/** 设计规范：标题 17/20 Medium · 正文 14/20 Regular · 辅助 12/16 Regular */
private val Agent567Typography =
    Typography(
        headlineSmall =
            TextStyle(
                fontWeight = FontWeight.SemiBold,
                fontSize = 22.sp,
                lineHeight = 28.sp,
            ),
        titleLarge =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 17.sp,
                lineHeight = 22.sp,
            ),
        titleMedium =
            TextStyle(
                fontWeight = FontWeight.Medium,
                fontSize = 17.sp,
                lineHeight = 20.sp,
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
                fontSize = 16.sp,
                lineHeight = 22.sp,
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
        large = RoundedCornerShape(18.dp),
        extraLarge = RoundedCornerShape(24.dp),
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
    val extra =
        if (dark) {
            Agent567ExtraColors(
                pageBackground = Agent567Palette.DarkPageBg,
                secondaryText = Color(0xFFAEAEB2),
                border = Agent567Palette.DarkBorder,
                chipBackground = Agent567Palette.DarkElevated,
                success = Color(0xFF30D158),
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
    androidx.compose.runtime.CompositionLocalProvider(LocalAgent567Extra provides extra) {
        MaterialTheme(
            colorScheme = if (dark) DarkScheme else LightScheme,
            typography = Agent567Typography,
            shapes = Agent567Shapes,
            content = content,
        )
    }
}

val MaterialTheme.agent567Extra: Agent567ExtraColors
    @Composable
    get() = LocalAgent567Extra.current
