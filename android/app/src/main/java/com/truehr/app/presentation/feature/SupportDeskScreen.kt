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
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.SupportAgent
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.MenuTile
import com.truehr.app.presentation.components.initials
import com.truehr.app.presentation.navigation.Routes
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*

private data class Desk(val label: String, val icon: ImageVector, val route: String, val tint: androidx.compose.ui.graphics.Color)

@Composable
fun SupportDeskScreen(onOpen: (String) -> Unit, onBack: () -> Unit, profileVm: ProfileViewModel = hiltViewModel()) {
  val p by profileVm.state.collectAsState()
  val tiles = listOf(
    Desk("HR Support", Icons.Filled.SupportAgent, Routes.supportCreate("HR"), Green),
    Desk("View HR Ticket Details", Icons.Filled.Description, Routes.supportView("HR"), Sky),
    Desk("IT Support", Icons.Filled.Computer, Routes.supportCreate("IT"), Violet),
    Desk("View IT Ticket Details", Icons.Filled.Description, Routes.supportView("IT"), Teal),
    Desk("Admin Support", Icons.Filled.Build, Routes.supportCreate("ADMIN"), Amber),
    Desk("Admin Support View", Icons.Filled.Description, Routes.supportView("ADMIN"), Grape),
  )
  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
          IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
          Text("Support Desk", color = Surface, style = MaterialTheme.typography.titleLarge)
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
          Box(Modifier.size(46.dp).clip(CircleShape).background(Surface.copy(alpha = 0.25f)), contentAlignment = Alignment.Center) {
            Text(initials(p.data?.fullName ?: "?"), color = Surface, fontWeight = FontWeight.Bold)
          }
          Spacer(Modifier.width(12.dp))
          Column {
            Text(p.data?.fullName ?: "—", color = Surface, fontWeight = FontWeight.Bold)
            Text(p.data?.designation ?: "", color = Surface.copy(alpha = 0.9f), style = MaterialTheme.typography.bodyMedium)
          }
        }
      }
    }
    LazyVerticalGrid(columns = GridCells.Fixed(3), contentPadding = PaddingValues(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
      items(tiles) { t ->
        MenuTile(t.label, t.icon, t.tint) { onOpen(t.route) }
      }
    }
  }
}
