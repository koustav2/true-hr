package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.border
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Login
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.AttendanceDay
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*

@Composable
fun DailyAttendanceScreen(onBack: () -> Unit, employeeId: Long? = null, name: String? = null, vm: AttendanceViewModel = hiltViewModel()) {
  val s by vm.daily.collectAsState()
  LaunchedEffect(Unit) { vm.loadDaily(employeeId = employeeId) }
  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
          IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
          Text("Daily Attendance", color = Surface, style = MaterialTheme.typography.titleLarge)
        }
        if (!name.isNullOrBlank()) Text(name, color = Surface.copy(alpha = 0.9f), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 8.dp, top = 2.dp))
      }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.loadDaily() })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text("No attendance records this month.", color = InkSoft)
      }
      else -> LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        items(s.data!!) { day -> AttendanceDayCard(day) }
      }
    }
  }
}

@Composable
private fun AttendanceDayCard(day: AttendanceDay) {
  Surface(color = Surface, shape = RoundedCornerShape(18.dp), shadowElevation = 1.dp, border = androidx.compose.foundation.BorderStroke(1.dp, Line)) {
    Column(Modifier.fillMaxWidth()) {
      // Header strip: date + status pill
      Row(
        Modifier.fillMaxWidth().background(Green.copy(alpha = 0.06f)).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.widthIn(min = 42.dp)) {
          Text(day.dayName.uppercase(), color = Green, style = MaterialTheme.typography.labelSmall)
          Text(day.dayNum, color = Green, fontWeight = FontWeight.Black, style = MaterialTheme.typography.titleLarge)
        }
        Spacer(Modifier.width(14.dp))
        Text(day.dateLabel, fontWeight = FontWeight.Bold, color = Ink, modifier = Modifier.weight(1f))
        StatusPill(if (day.present) "Present" else "Absent", if (day.present) Green else Amber)
      }
      HorizontalDivider(color = Line)
      // In / Out rows
      Row(Modifier.fillMaxWidth().padding(14.dp)) {
        PunchColumn(Modifier.weight(1f), Icons.AutoMirrored.Filled.Login, "In Time", day.inTime, day.inLocation, Teal, day.inPhotoUrl)
        VerticalDivider(modifier = Modifier.height(64.dp), color = Line)
        PunchColumn(Modifier.weight(1f).padding(start = 12.dp), Icons.AutoMirrored.Filled.Logout, "Out Time", day.outTime, day.outLocation, Rose, day.outPhotoUrl)
      }
      // Total working hours (in → out)
      HorizontalDivider(color = Line)
      Row(
        Modifier.fillMaxWidth().background(Green.copy(alpha = 0.04f)).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(Icons.Filled.Schedule, null, tint = Green, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text("Total Working Hours", color = InkSoft, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(day.workHours ?: "—", color = Green, fontWeight = FontWeight.Bold)
      }
    }
  }
}

@Composable
private fun PunchColumn(modifier: Modifier, icon: ImageVector, label: String, time: String?, location: String?, tint: Color, photoUrl: String? = null) {
  Column(modifier) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Icon(icon, null, tint = tint, modifier = Modifier.size(16.dp))
      Spacer(Modifier.width(6.dp))
      Text(label, color = InkFaint, style = MaterialTheme.typography.labelSmall)
    }
    if (!photoUrl.isNullOrBlank()) {
      Spacer(Modifier.height(8.dp))
      AsyncImage(
        model = photoUrl, contentDescription = "$label photo", contentScale = ContentScale.Crop,
        modifier = Modifier.size(56.dp).clip(CircleShape).border(2.dp, tint.copy(alpha = 0.5f), CircleShape),
      )
    }
    Spacer(Modifier.height(8.dp))
    Text(time ?: "—", fontWeight = FontWeight.Bold, color = Ink)
    if (!location.isNullOrBlank()) {
      Spacer(Modifier.height(6.dp))
      Row(verticalAlignment = Alignment.Top) {
        Icon(Icons.Filled.Place, null, tint = InkFaint, modifier = Modifier.size(13.dp))
        Spacer(Modifier.width(4.dp))
        Text(location, color = InkSoft, style = MaterialTheme.typography.labelSmall, maxLines = 3)
      }
    }
  }
}

@Composable
private fun StatusPill(text: String, color: Color) {
  Surface(color = color.copy(alpha = 0.12f), shape = RoundedCornerShape(20.dp)) {
    Text(text, color = color, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
  }
}
