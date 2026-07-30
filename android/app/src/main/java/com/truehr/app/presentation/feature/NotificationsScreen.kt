package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.BeachAccess
import androidx.compose.material.icons.filled.MoreTime
import androidx.compose.material.icons.filled.NotificationsNone
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.data.remote.dto.NotificationDto
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*
import com.truehr.app.push.PushRoutes
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

private fun iconFor(type: String?): ImageVector = when {
  type == null -> Icons.Filled.NotificationsNone
  type.startsWith("LEAVE") -> Icons.Filled.BeachAccess
  type.startsWith("MISS_PUNCH") -> Icons.Filled.MoreTime
  type.startsWith("RESIGNATION") -> Icons.AutoMirrored.Filled.ExitToApp
  type.startsWith("ATTENDANCE") -> Icons.Filled.PauseCircle
  else -> Icons.Filled.NotificationsNone
}

private fun tintFor(type: String?): androidx.compose.ui.graphics.Color = when {
  type == null -> InkFaint
  type.endsWith("APPROVED") -> Green
  type.endsWith("REJECTED") -> Rose
  type.startsWith("ATTENDANCE") -> Amber
  else -> Sky
}

private fun timeLabel(iso: String?): String {
  if (iso.isNullOrBlank()) return ""
  return try {
    val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
    val date = parser.parse(iso.take(19)) ?: return ""
    SimpleDateFormat("dd MMM yyyy, h:mm a", Locale.getDefault()).format(date)
  } catch (_: Exception) { "" }
}

@Composable
fun NotificationsScreen(onBack: () -> Unit, onOpen: (String) -> Unit, vm: NotificationsViewModel = hiltViewModel()) {
  val s by vm.list.collectAsState()
  LaunchedEffect(Unit) { vm.load() }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Notifications", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load() })
      else -> {
        val items = s.data ?: emptyList()
        if (items.isEmpty()) {
          Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
              Icon(Icons.Filled.NotificationsNone, null, tint = InkFaint, modifier = Modifier.size(44.dp))
              Spacer(Modifier.height(10.dp))
              Text("No notifications yet.", color = InkSoft)
            }
          }
        } else {
          LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(items, key = { it.id }) { n -> NotificationCard(n) { onOpen(PushRoutes.toNavRoute(n.route)) } }
          }
        }
      }
    }
  }
}

@Composable
private fun NotificationCard(n: NotificationDto, onClick: () -> Unit) {
  val tint = tintFor(n.type)
  Surface(
    color = Surface,
    shape = RoundedCornerShape(16.dp),
    shadowElevation = 1.dp,
    border = androidx.compose.foundation.BorderStroke(1.dp, if (n.read) Line else tint.copy(alpha = 0.45f)),
  ) {
    Row(Modifier.clickable(onClick = onClick).padding(14.dp), verticalAlignment = Alignment.Top) {
      Box(
        Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(tint.copy(alpha = 0.12f)),
        contentAlignment = Alignment.Center,
      ) {
        Icon(iconFor(n.type), null, tint = tint, modifier = Modifier.size(20.dp))
      }
      Spacer(Modifier.width(12.dp))
      Column(Modifier.weight(1f)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text(
            n.title ?: "Notification",
            fontWeight = if (n.read) FontWeight.SemiBold else FontWeight.Bold,
            color = Ink,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
          )
          if (!n.read) Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(tint))
        }
        if (!n.body.isNullOrBlank()) {
          Spacer(Modifier.height(2.dp))
          Text(n.body, color = InkSoft, style = MaterialTheme.typography.bodyMedium)
        }
        Spacer(Modifier.height(6.dp))
        Text(timeLabel(n.createdAt), color = InkFaint, style = MaterialTheme.typography.labelSmall)
      }
    }
  }
}
