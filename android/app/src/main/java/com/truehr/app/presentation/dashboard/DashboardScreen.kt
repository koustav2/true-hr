package com.truehr.app.presentation.dashboard

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.Avatar
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.navigation.Routes
import com.truehr.app.presentation.theme.*

@Composable
fun DashboardScreen(onOpen: (String) -> Unit, onLoggedOut: () -> Unit, vm: DashboardViewModel = hiltViewModel()) {
  val header by vm.header.collectAsState()
  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Avatar(header.name)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
          Text(header.name, color = Surface, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
          if (header.designation.isNotBlank()) Text(header.designation, color = Surface.copy(alpha = 0.85f), style = MaterialTheme.typography.bodyMedium)
        }
        IconButton(onClick = {}) { Icon(Icons.Filled.Notifications, null, tint = Surface) }
        IconButton(onClick = { vm.logout(onLoggedOut) }) { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = Surface) }
      }
    }
    val items = dashboardItems.filter { header.isManager || it.route != Routes.TEAM }
    LazyVerticalGrid(
      columns = GridCells.Fixed(3),
      modifier = Modifier.fillMaxSize(),
      contentPadding = PaddingValues(2.dp),
    ) {
      items(items) { item ->
        DashboardTile(item) { onOpen(item.route) }
      }
    }
  }
}

@Composable
private fun DashboardTile(item: DashItem, onClick: () -> Unit) {
  Surface(color = Surface, modifier = Modifier.fillMaxWidth().aspectRatio(0.95f).padding(1.dp)) {
    Column(
      Modifier.clickable(onClick = onClick).padding(12.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.Center,
    ) {
      Box(Modifier.size(54.dp).clip(CircleShape).background(Green.copy(alpha = 0.10f)), contentAlignment = Alignment.Center) {
        Icon(item.icon, null, tint = Green, modifier = Modifier.size(28.dp))
      }
      Spacer(Modifier.height(10.dp))
      Text(item.label, style = MaterialTheme.typography.labelSmall, color = Ink, textAlign = TextAlign.Center, maxLines = 2)
    }
  }
}
