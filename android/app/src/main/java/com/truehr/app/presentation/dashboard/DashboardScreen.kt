package com.truehr.app.presentation.dashboard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CalendarToday
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.Avatar
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.HeaderIconButton
import com.truehr.app.presentation.components.SectionTitle
import com.truehr.app.presentation.navigation.Routes
import com.truehr.app.presentation.theme.*
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private fun greeting(): String = when (Calendar.getInstance().get(Calendar.HOUR_OF_DAY)) {
  in 5..11 -> "Good Morning"
  in 12..16 -> "Good Afternoon"
  else -> "Good Evening"
}

@Composable
fun DashboardScreen(onOpen: (String) -> Unit, onLoggedOut: () -> Unit, vm: DashboardViewModel = hiltViewModel()) {
  val header by vm.header.collectAsState()
  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Avatar(header.name, 52)
          Spacer(Modifier.width(13.dp))
          Column(Modifier.weight(1f)) {
            Text(greeting(), color = Surface.copy(alpha = 0.72f), style = MaterialTheme.typography.labelMedium)
            Text(
              header.name.ifBlank { "Welcome" },
              color = Surface,
              style = MaterialTheme.typography.titleLarge,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
            if (header.designation.isNotBlank()) {
              Text(header.designation, color = Surface.copy(alpha = 0.8f), style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
          }
          HeaderIconButton(Icons.Filled.Notifications, "Notifications") {}
          Spacer(Modifier.width(8.dp))
          AccountMenu(onOpen = onOpen, onLogout = { vm.logout(onLoggedOut) })
        }
        Spacer(Modifier.height(14.dp))
        Row(
          verticalAlignment = Alignment.CenterVertically,
          modifier = Modifier
            .clip(RoundedCornerShape(50))
            .background(Color.White.copy(alpha = 0.12f))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        ) {
          Icon(Icons.Filled.CalendarToday, null, tint = Surface.copy(alpha = 0.8f), modifier = Modifier.size(13.dp))
          Spacer(Modifier.width(7.dp))
          Text(
            SimpleDateFormat("EEEE, d MMMM yyyy", Locale.ENGLISH).format(Date()),
            color = Surface.copy(alpha = 0.9f),
            style = MaterialTheme.typography.labelMedium,
          )
        }
      }
    }
    val items = dashboardItems.filter { header.isManager || it.route != Routes.TEAM }
    LazyVerticalGrid(
      columns = GridCells.Fixed(3),
      modifier = Modifier.fillMaxSize(),
      contentPadding = PaddingValues(start = 16.dp, top = 16.dp, end = 16.dp, bottom = 28.dp),
      horizontalArrangement = Arrangement.spacedBy(10.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      item(span = { GridItemSpan(maxLineSpan) }) {
        SectionTitle("Workspace")
      }
      items(items) { item ->
        DashboardTile(item) { onOpen(item.route) }
      }
    }
  }
}

/** Top-right account menu: profile, support, policies, password, resignation + logout. */
@Composable
private fun AccountMenu(onOpen: (String) -> Unit, onLogout: () -> Unit) {
  var open by remember { mutableStateOf(false) }
  var confirmLogout by remember { mutableStateOf(false) }

  if (confirmLogout) {
    AlertDialog(
      onDismissRequest = { confirmLogout = false },
      shape = RoundedCornerShape(22.dp),
      containerColor = Surface,
      title = { Text("Logout", style = MaterialTheme.typography.titleLarge, color = Ink) },
      text = { Text("Do you want to logout?", style = MaterialTheme.typography.bodyLarge, color = InkSoft) },
      confirmButton = {
        TextButton(onClick = { confirmLogout = false; onLogout() }) {
          Text("Okay", color = Rose, style = MaterialTheme.typography.labelLarge)
        }
      },
      dismissButton = {
        TextButton(onClick = { confirmLogout = false }) {
          Text("Cancel", color = InkSoft, style = MaterialTheme.typography.labelLarge)
        }
      },
    )
  }

  Box {
    HeaderIconButton(Icons.Filled.MoreVert, "Account menu") { open = true }
    DropdownMenu(
      expanded = open,
      onDismissRequest = { open = false },
      modifier = Modifier.background(Surface).widthIn(min = 224.dp),
    ) {
      settingsMenuItems.forEach { item ->
        DropdownMenuItem(
          text = { Text(item.label, style = MaterialTheme.typography.bodyLarge, color = Ink) },
          leadingIcon = {
            Box(
              modifier = Modifier.size(32.dp).clip(RoundedCornerShape(10.dp)).background(item.tint.copy(alpha = 0.12f)),
              contentAlignment = Alignment.Center,
            ) {
              Icon(item.icon, null, tint = item.tint, modifier = Modifier.size(17.dp))
            }
          },
          onClick = { open = false; onOpen(item.route) },
        )
      }
      HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 4.dp))
      DropdownMenuItem(
        text = { Text("Logout", style = MaterialTheme.typography.bodyLarge, color = Rose, fontWeight = FontWeight.SemiBold) },
        leadingIcon = {
          Box(
            modifier = Modifier.size(32.dp).clip(RoundedCornerShape(10.dp)).background(Rose.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
          ) {
            Icon(Icons.AutoMirrored.Filled.Logout, null, tint = Rose, modifier = Modifier.size(17.dp))
          }
        },
        onClick = { open = false; confirmLogout = true },
      )
    }
  }
}

@Composable
private fun DashboardTile(item: DashItem, onClick: () -> Unit) {
  Surface(
    color = Surface,
    shape = RoundedCornerShape(18.dp),
    border = BorderStroke(1.dp, Line),
    shadowElevation = 1.dp,
    modifier = Modifier.fillMaxWidth().aspectRatio(1.04f),
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
          .background(item.tint.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
      ) {
        Icon(item.icon, null, tint = item.tint, modifier = Modifier.size(24.dp))
      }
      Spacer(Modifier.height(9.dp))
      Text(
        item.label,
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
