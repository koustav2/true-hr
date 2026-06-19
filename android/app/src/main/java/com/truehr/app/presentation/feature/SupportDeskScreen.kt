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
import com.truehr.app.presentation.components.initials
import com.truehr.app.presentation.navigation.Routes
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*

private data class Desk(val label: String, val icon: ImageVector, val route: String)

@Composable
fun SupportDeskScreen(onOpen: (String) -> Unit, onBack: () -> Unit, profileVm: ProfileViewModel = hiltViewModel()) {
  val p by profileVm.state.collectAsState()
  val tiles = listOf(
    Desk("HR Support", Icons.Filled.SupportAgent, Routes.supportCreate("HR")),
    Desk("View HR Ticket Details", Icons.Filled.Description, Routes.supportView("HR")),
    Desk("IT Support", Icons.Filled.Computer, Routes.supportCreate("IT")),
    Desk("View IT Ticket Details", Icons.Filled.Description, Routes.supportView("IT")),
    Desk("Admin Support", Icons.Filled.Build, Routes.supportCreate("ADMIN")),
    Desk("Admin Support View", Icons.Filled.Description, Routes.supportView("ADMIN")),
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
    LazyVerticalGrid(columns = GridCells.Fixed(2), contentPadding = PaddingValues(14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      items(tiles) { t ->
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
