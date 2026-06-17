package com.truehr.app.presentation.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

val AppTypography = Typography(
  headlineSmall = TextStyle(fontWeight = FontWeight.Bold, fontSize = 22.sp),
  titleLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 19.sp),
  titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
  bodyLarge = TextStyle(fontWeight = FontWeight.Normal, fontSize = 15.sp),
  bodyMedium = TextStyle(fontWeight = FontWeight.Normal, fontSize = 13.5.sp),
  labelLarge = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
  labelSmall = TextStyle(fontWeight = FontWeight.Medium, fontSize = 11.sp),
)
