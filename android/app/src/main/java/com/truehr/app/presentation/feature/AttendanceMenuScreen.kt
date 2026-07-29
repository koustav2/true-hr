package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.MenuTile
import com.truehr.app.presentation.navigation.Routes
import com.truehr.app.presentation.theme.*

private data class AttItem(val label: String, val icon: ImageVector, val route: String, val tint: androidx.compose.ui.graphics.Color)

@Composable
fun AttendanceMenuScreen(onOpen: (String) -> Unit, onBack: () -> Unit) {
  // All tiles show for everyone; team screens show a "No team yet" message when applicable.
  val items = listOf(
    AttItem("Mark Attendance", Icons.Filled.TouchApp, Routes.MARK_ATTENDANCE, Green),
    AttItem("Daily Attendance", Icons.Filled.FactCheck, Routes.DAILY_ATTENDANCE, Sky),
    AttItem("Monthly Attendance", Icons.Filled.CalendarMonth, Routes.MONTHLY_ATTENDANCE, Violet),
    AttItem("Team Attendance", Icons.Filled.Groups, Routes.TEAM_ATTENDANCE, Amber),
    AttItem("Apply OD", Icons.Filled.EditCalendar, Routes.APPLY_OD, Teal),
    AttItem("View OD", Icons.Filled.EventAvailable, Routes.VIEW_OD, Grape),
    AttItem("Apply Miss Punch", Icons.Filled.MoreTime, Routes.APPLY_MISS_PUNCH, Rose),
    AttItem("View Miss Punch", Icons.Filled.EventNote, Routes.VIEW_MISS_PUNCH, Sky),
    AttItem("Team Miss Punch", Icons.Filled.Groups, Routes.TEAM_MISS_PUNCH, Violet),
    AttItem("Hold Team Attendance", Icons.Filled.PauseCircle, Routes.HOLD_TEAM_ATTENDANCE, Amber),
  )
  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Attendance Menu", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    LazyVerticalGrid(columns = GridCells.Fixed(3), contentPadding = PaddingValues(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      items(items) { item ->
        MenuTile(item.label, item.icon, item.tint) { onOpen(item.route) }
      }
    }
  }
}
