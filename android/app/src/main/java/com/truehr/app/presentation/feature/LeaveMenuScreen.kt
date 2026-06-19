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
import androidx.compose.material.icons.filled.EditCalendar
import androidx.compose.material.icons.filled.EventAvailable
import androidx.compose.material.icons.filled.EventNote
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.WorkHistory
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

private data class LeaveTile(val label: String, val icon: ImageVector, val route: String, val managerOnly: Boolean = false)

@Composable
fun LeaveMenuScreen(onOpen: (String) -> Unit, onBack: () -> Unit, profileVm: ProfileViewModel = hiltViewModel()) {
  val profile by profileVm.state.collectAsState()
  val isManager = profile.data?.isManager == true
  val tiles = listOf(
    LeaveTile("Apply Leave", Icons.Filled.EditCalendar, Routes.APPLY_LEAVE),
    LeaveTile("View Leave", Icons.Filled.EventNote, Routes.VIEW_LEAVE),
    LeaveTile("Team Leave", Icons.Filled.Groups, Routes.TEAM_LEAVE, managerOnly = true),
    LeaveTile("Avail CompOff", Icons.Filled.EventAvailable, Routes.AVAIL_COMPOFF),
    LeaveTile("Team CompOff", Icons.Filled.WorkHistory, Routes.TEAM_COMPOFF, managerOnly = true),
    LeaveTile("Team OD", Icons.Filled.FactCheck, Routes.TEAM_OD, managerOnly = true),
  )
  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Leave Management", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    LazyVerticalGrid(columns = GridCells.Fixed(2), contentPadding = PaddingValues(14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      items(tiles.filter { isManager || !it.managerOnly }) { t ->
        Surface(color = Surface, shape = RoundedCornerShape(18.dp), shadowElevation = 2.dp, modifier = Modifier.fillMaxWidth().height(150.dp)) {
          Column(Modifier.clickable { onOpen(t.route) }.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Box(Modifier.size(58.dp).clip(CircleShape).background(Green.copy(alpha = 0.10f)), contentAlignment = Alignment.Center) {
              Icon(t.icon, null, tint = Green, modifier = Modifier.size(28.dp))
            }
            Spacer(Modifier.height(12.dp))
            Text(t.label, style = MaterialTheme.typography.labelLarge, color = Ink, textAlign = TextAlign.Center)
          }
        }
      }
    }
  }
}
