package com.truehr.app.presentation.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val LightColors = lightColorScheme(
  primary = Green,
  onPrimary = Surface,
  secondary = Teal,
  background = Canvas,
  onBackground = Ink,
  surface = Surface,
  onSurface = Ink,
  error = Rose,
)

@Composable
fun TrueHrTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
  MaterialTheme(
    colorScheme = LightColors,
    typography = AppTypography,
    content = content,
  )
}
