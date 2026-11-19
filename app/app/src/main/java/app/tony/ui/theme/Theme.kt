package app.tony.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import app.tony.R

/** Paleta única: preto e branco. O único acento é o próprio branco. */
object TonyColors {
    val Bg = Color(0xFF000000)
    val Surface = Color(0xFF0F0F0F)
    val Elevated = Color(0xFF141414)
    val Elevated2 = Color(0xFF111111)
    val Border = Color(0xFF1C1C1C)
    val Border2 = Color(0xFF262626)
    val BorderMark = Color(0xFF2A2A2A)
    val Text = Color(0xFFFAFAFA)
    val Text2 = Color(0xFF8A8A8A) // contraste 6,1:1 sobre #000
    val Text3 = Color(0xFFBDBDBD) // saídas
    val OnPrimary = Color(0xFF000000)

    val In = Text
    val Out = Text3
}

val Inter = FontFamily(
    Font(R.font.inter_regular, FontWeight.Normal),
    Font(R.font.inter_medium, FontWeight.Medium),
    Font(R.font.inter_semibold, FontWeight.SemiBold),
)

/** Estilos com nome do design. Tudo em sp: respeita o tamanho de fonte do sistema. */
object TonyType {
    val Balance = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 46.sp, letterSpacing = (-0.04).em, lineHeight = 52.sp)
    val CardValue = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 19.sp, letterSpacing = (-0.02).em)
    val Title = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, letterSpacing = (-0.02).em)
    val ScreenTitle = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, letterSpacing = (-0.03).em)
    val Section = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, letterSpacing = (-0.01).em)
    val Body = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 21.sp)
    val BodyMedium = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 21.sp)
    val Chat = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 24.sp)
    val Label = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 14.sp)
    val Caption = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 17.sp)
    val Small = TextStyle(fontFamily = Inter, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp)
    val Wordmark = TextStyle(fontFamily = Inter, fontWeight = FontWeight.SemiBold, fontSize = 40.sp, letterSpacing = (-0.045).em)
}

private val colorScheme = darkColorScheme(
    primary = TonyColors.Text,
    onPrimary = TonyColors.OnPrimary,
    primaryContainer = TonyColors.Elevated,
    onPrimaryContainer = TonyColors.Text,
    secondary = TonyColors.Text3,
    onSecondary = TonyColors.OnPrimary,
    secondaryContainer = TonyColors.Elevated,
    onSecondaryContainer = TonyColors.Text,
    tertiary = TonyColors.Text3,
    onTertiary = TonyColors.OnPrimary,
    background = TonyColors.Bg,
    onBackground = TonyColors.Text,
    surface = TonyColors.Bg,
    onSurface = TonyColors.Text,
    surfaceVariant = TonyColors.Surface,
    onSurfaceVariant = TonyColors.Text2,
    surfaceContainerLowest = TonyColors.Bg,
    surfaceContainerLow = TonyColors.Surface,
    surfaceContainer = TonyColors.Surface,
    surfaceContainerHigh = TonyColors.Elevated,
    surfaceContainerHighest = TonyColors.Elevated,
    surfaceBright = TonyColors.Elevated,
    surfaceDim = TonyColors.Bg,
    surfaceTint = Color.Transparent,
    inverseSurface = TonyColors.Text,
    inverseOnSurface = TonyColors.OnPrimary,
    outline = TonyColors.Border2,
    outlineVariant = TonyColors.Border,
    error = TonyColors.Text,
    onError = TonyColors.OnPrimary,
    errorContainer = TonyColors.Elevated,
    onErrorContainer = TonyColors.Text,
    scrim = Color(0xCC000000),
)

private val typography = Typography(
    bodyLarge = TonyType.Chat,
    bodyMedium = TonyType.Body,
    bodySmall = TonyType.Caption,
    titleLarge = TonyType.ScreenTitle,
    titleMedium = TonyType.Title,
    titleSmall = TonyType.Section,
    labelLarge = TonyType.BodyMedium,
    labelMedium = TonyType.Caption,
    labelSmall = TonyType.Small,
    headlineLarge = TonyType.Balance,
    headlineMedium = TonyType.ScreenTitle,
    headlineSmall = TonyType.Title,
    displayLarge = TonyType.Balance,
    displayMedium = TonyType.Balance,
    displaySmall = TonyType.ScreenTitle,
)

private val shapes = Shapes(
    extraSmall = RoundedCornerShape(12.dp),
    small = RoundedCornerShape(16.dp),
    medium = RoundedCornerShape(20.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun TonyTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colorScheme, typography = typography, shapes = shapes, content = content)
}
