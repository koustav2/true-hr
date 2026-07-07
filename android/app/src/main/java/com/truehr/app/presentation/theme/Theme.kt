package com.truehr.app.presentation.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

private val LightColors = lightColorScheme(
  primary = Green,
  onPrimary = Surface,
  primaryContainer = SurfaceTint,
  onPrimaryContainer = GreenDark,
  secondary = Teal,
  onSecondary = Surface,
  background = Canvas,
  onBackground = Ink,
  surface = Surface,
  onSurface = Ink,
  surfaceVariant = SurfaceTint,
  onSurfaceVariant = InkSoft,
  outline = Line,
  outlineVariant = Line,
  error = Rose,
)

private val AppShapes = Shapes(
  extraSmall = RoundedCornerShape(8.dp),
  small = RoundedCornerShape(12.dp),
  medium = RoundedCornerShape(16.dp),
  large = RoundedCornerShape(22.dp),
  extraLarge = RoundedCornerShape(28.dp),
)

@Composable
fun TrueHrTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
  MaterialTheme(
    colorScheme = LightColors,
    typography = AppTypography,
    shapes = AppShapes,
    content = content,
  )
}
