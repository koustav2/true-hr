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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.navigation.Routes
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*

private data class AttItem(val label: String, val icon: ImageVector, val route: String)

private val TEAM_ROUTES = setOf(Routes.TEAM_ATTENDANCE, Routes.TEAM_MISS_PUNCH)

@Composable
fun AttendanceMenuScreen(onOpen: (String) -> Unit, onBack: () -> Unit, profileVm: ProfileViewModel = hiltViewModel()) {
  val profile by profileVm.state.collectAsState()
  val isManager = profile.data?.isManager == true
  val items = listOf(
    AttItem("Mark Attendance", Icons.Filled.TouchApp, Routes.MARK_ATTENDANCE),
    AttItem("Daily Attendance", Icons.Filled.FactCheck, Routes.DAILY_ATTENDANCE),
    AttItem("Monthly Attendance", Icons.Filled.CalendarMonth, Routes.MONTHLY_ATTENDANCE),
    AttItem("Team Attendance", Icons.Filled.Groups, Routes.TEAM_ATTENDANCE),
    AttItem("Hold Team Attendance", Icons.Filled.PauseCircle, Routes.HOLD_TEAM_ATTENDANCE),
    AttItem("Apply OD", Icons.Filled.EditCalendar, Routes.APPLY_OD),
    AttItem("View OD", Icons.Filled.EventAvailable, Routes.VIEW_OD),
    AttItem("Apply Miss Punch", Icons.Filled.MoreTime, Routes.APPLY_MISS_PUNCH),
    AttItem("View Miss Punch", Icons.Filled.EventNote, Routes.VIEW_MISS_PUNCH),
    AttItem("Team Miss Punch", Icons.Filled.Groups, Routes.TEAM_MISS_PUNCH),
  )
  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Attendance Menu", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    LazyVerticalGrid(columns = GridCells.Fixed(2), contentPadding = PaddingValues(14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      items(items.filter { isManager || it.route !in TEAM_ROUTES }) { item ->
        Surface(color = Surface, shape = RoundedCornerShape(18.dp), shadowElevation = 2.dp, modifier = Modifier.fillMaxWidth().height(150.dp)) {
          Column(Modifier.clickable { onOpen(item.route) }.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Box(Modifier.size(58.dp).clip(CircleShape).background(Green.copy(alpha = 0.10f)), contentAlignment = Alignment.Center) {
              Icon(item.icon, null, tint = Green, modifier = Modifier.size(28.dp))
            }
            Spacer(Modifier.height(12.dp))
            Text(item.label, style = MaterialTheme.typography.labelLarge, color = Ink, textAlign = TextAlign.Center)
          }
        }
      }
    }
  }
}
