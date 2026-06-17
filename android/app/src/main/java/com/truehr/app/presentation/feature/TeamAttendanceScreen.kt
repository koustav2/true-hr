package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Today
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.TeamMember
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.theme.*

@Composable
fun TeamAttendanceScreen(
  onBack: () -> Unit,
  onOpenDaily: (TeamMember) -> Unit = {},
  onOpenMonthly: (TeamMember) -> Unit = {},
  vm: AttendanceViewModel = hiltViewModel(),
) {
  val s by vm.team.collectAsState()
  var q by remember { mutableStateOf("") }
  LaunchedEffect(Unit) { vm.loadTeam() }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Team Attendance", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    OutlinedTextField(
      value = q, onValueChange = { q = it },
      placeholder = { Text("Search Name, ID or Designation…") },
      leadingIcon = { Icon(Icons.Filled.Search, null, tint = Green) },
      singleLine = true, shape = RoundedCornerShape(14.dp),
      colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
      modifier = Modifier.fillMaxWidth().padding(14.dp),
    )
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.loadTeam() })
      else -> {
        val list = (s.data ?: emptyList()).filter {
          q.isBlank() || "${it.name} ${it.employeeCode} ${it.designation}".contains(q, ignoreCase = true)
        }
        if (list.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No team members found.", color = InkSoft) }
        else LazyColumn(contentPadding = PaddingValues(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
          items(list) { m -> TeamCard(m, onOpenDaily = { onOpenDaily(m) }, onOpenMonthly = { onOpenMonthly(m) }) }
        }
      }
    }
  }
}

@Composable
private fun TeamCard(m: TeamMember, onOpenDaily: () -> Unit, onOpenMonthly: () -> Unit) {
  Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp) {
    Column {
      Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp).clip(CircleShape).background(Green.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
          Text(initials(m.name), color = Green, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
          Text(m.name, fontWeight = FontWeight.Bold, color = Ink)
          Text("${m.employeeCode} · ${m.designation ?: "—"}", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
        }
        val present = m.status.equals("Present", true)
        Surface(color = (if (present) Green else InkFaint).copy(alpha = 0.12f), shape = RoundedCornerShape(20.dp)) {
          Text(m.status, color = if (present) Green else InkFaint, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
        }
      }
      HorizontalDivider(color = Line)
      Row(Modifier.fillMaxWidth().padding(14.dp)) {
        Column(Modifier.weight(1f)) {
          Text("Punch In", color = InkFaint, style = MaterialTheme.typography.labelSmall)
          Text(m.punchIn ?: "—", color = Ink, fontWeight = FontWeight.SemiBold)
        }
        Column(Modifier.weight(1f)) {
          Text("Punch Out", color = InkFaint, style = MaterialTheme.typography.labelSmall)
          Text(m.punchOut ?: "—", color = Ink, fontWeight = FontWeight.SemiBold)
        }
      }
      HorizontalDivider(color = Line)
      Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedButton(
          onClick = onOpenDaily, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp),
          colors = ButtonDefaults.outlinedButtonColors(contentColor = Green),
        ) {
          Icon(Icons.Filled.Today, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
          Text("Daily", fontWeight = FontWeight.SemiBold)
        }
        OutlinedButton(
          onClick = onOpenMonthly, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp),
          colors = ButtonDefaults.outlinedButtonColors(contentColor = Teal),
        ) {
          Icon(Icons.Filled.CalendarMonth, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
          Text("Monthly", fontWeight = FontWeight.SemiBold)
        }
      }
    }
  }
}
