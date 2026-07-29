package com.truehr.app.presentation.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.truehr.app.presentation.theme.*

/**
 * Square menu tile shared by the dashboard and every feature hub
 * (Attendance, Leave, Tour, Support Desk, NFA, ESS): tinted rounded icon
 * well + small semibold label — one look everywhere.
 */
@Composable
fun MenuTile(label: String, icon: ImageVector, tint: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
  Surface(
    color = Surface,
    shape = RoundedCornerShape(18.dp),
    border = BorderStroke(1.dp, Line),
    shadowElevation = 1.dp,
    modifier = modifier.fillMaxWidth().aspectRatio(1.04f),
  ) {
    Column(
      Modifier.clickable(onClick = onClick).padding(10.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.Center,
    ) {
      Box(
        modifier = Modifier
          .size(46.dp)
          .clip(RoundedCornerShape(14.dp))
          .background(tint.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
      ) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(24.dp))
      }
      Spacer(Modifier.height(9.dp))
      Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = Ink,
        textAlign = TextAlign.Center,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
      )
    }
  }
}
