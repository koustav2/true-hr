package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PauseCircle
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.TeamMember
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*

@Composable
fun HoldTeamScreen(onBack: () -> Unit, vm: AttendanceViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val profile by profileVm.state.collectAsState()
  val isManager = profile.data?.isManager == true
  val s by vm.team.collectAsState()
  val holdBusy by vm.holdBusy.collectAsState()

  LaunchedEffect(isManager) { if (isManager) vm.loadTeam() }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Hold Team Attendance", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }

    if (profile.loading) { CenterLoader(); return@Column }

    if (!isManager) {
      Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(Modifier.size(76.dp).clip(CircleShape).background(Amber.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
          Icon(Icons.Filled.Lock, null, tint = Amber, modifier = Modifier.size(36.dp))
        }
        Spacer(Modifier.height(16.dp))
        Text("Not applicable", style = MaterialTheme.typography.titleMedium, color = Ink)
        Spacer(Modifier.height(6.dp))
        Text("This facility is not applicable for you. Only managers with team members can hold attendance.",
          color = InkSoft, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
      }
      return@Column
    }

    Surface(color = Amber.copy(alpha = 0.10f), modifier = Modifier.fillMaxWidth().padding(14.dp), shape = RoundedCornerShape(12.dp)) {
      Text("You can hold a team member's attendance for today only. A hold auto-releases when they punch out.",
        color = Ink, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(12.dp))
    }

    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.loadTeam() })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No team members.", color = InkSoft) }
      else -> LazyColumn(contentPadding = PaddingValues(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(s.data!!) { m -> HoldCard(m, busy = holdBusy == m.employeeId, onToggle = { vm.toggleHold(m) }) }
      }
    }
  }
}

@Composable
private fun HoldCard(m: TeamMember, busy: Boolean, onToggle: () -> Unit) {
  Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp) {
    Column(Modifier.padding(14.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp).clip(CircleShape).background(Green.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
          Text(initials(m.name), color = Green, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
          Text(m.name, fontWeight = FontWeight.Bold, color = Ink)
          Text("${m.employeeCode} · ${m.designation ?: "—"}", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
        }
        if (m.held) Surface(color = Amber.copy(alpha = 0.15f), shape = RoundedCornerShape(20.dp)) {
          Row(Modifier.padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.PauseCircle, null, tint = Amber, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp))
            Text("On Hold", color = Amber, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
          }
        }
      }
      Spacer(Modifier.height(10.dp))
      Row(Modifier.fillMaxWidth()) {
        Column(Modifier.weight(1f)) { Text("Punch In", color = InkFaint, style = MaterialTheme.typography.labelSmall); Text(m.punchIn ?: "—", fontWeight = FontWeight.SemiBold, color = Ink) }
        Column(Modifier.weight(1f)) { Text("Punch Out", color = InkFaint, style = MaterialTheme.typography.labelSmall); Text(m.punchOut ?: "—", fontWeight = FontWeight.SemiBold, color = Ink) }
      }
      Spacer(Modifier.height(12.dp))
      val punchedOut = !m.punchOut.isNullOrBlank()
      val canAct = m.held || !punchedOut   // cannot place a new hold once they've punched out
      Button(
        onClick = onToggle, enabled = !busy && canAct,
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(
          containerColor = if (m.held) Green else Amber, contentColor = Surface,
          disabledContainerColor = Line, disabledContentColor = InkFaint,
        ),
        modifier = Modifier.fillMaxWidth(),
      ) {
        if (busy) CircularProgressIndicator(color = Surface, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
        else Text(if (m.held) "Release Hold" else if (punchedOut) "Punched Out" else "Hold Attendance", fontWeight = FontWeight.SemiBold)
      }
      if (punchedOut && !m.held) Text(
        "Already punched out — attendance can no longer be held.",
        color = InkFaint, style = MaterialTheme.typography.labelSmall,
        modifier = Modifier.padding(top = 6.dp),
      )
    }
  }
}
