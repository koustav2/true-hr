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

private data class LeaveTile(val label: String, val icon: ImageVector, val route: String, val tint: androidx.compose.ui.graphics.Color)

@Composable
fun LeaveMenuScreen(onOpen: (String) -> Unit, onBack: () -> Unit) {
  // All tiles show for everyone. Team screens themselves display a "No team yet" message
  // when the signed-in user has nobody reporting to them.
  val tiles = listOf(
    LeaveTile("Apply Leave", Icons.Filled.EditCalendar, Routes.APPLY_LEAVE, Green),
    LeaveTile("View Leave", Icons.Filled.EventNote, Routes.VIEW_LEAVE, Sky),
    LeaveTile("Avail CompOff", Icons.Filled.EventAvailable, Routes.AVAIL_COMPOFF, Teal),
    LeaveTile("Team CompOff", Icons.Filled.WorkHistory, Routes.TEAM_COMPOFF, Amber),
    LeaveTile("Team Leave", Icons.Filled.Groups, Routes.TEAM_LEAVE, Violet),
    LeaveTile("Team OD", Icons.Filled.FactCheck, Routes.TEAM_OD, Grape),
  )
  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Leave Management", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    LazyVerticalGrid(columns = GridCells.Fixed(3), contentPadding = PaddingValues(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      items(tiles) { t ->
        MenuTile(t.label, t.icon, t.tint) { onOpen(t.route) }
      }
    }
  }
}
