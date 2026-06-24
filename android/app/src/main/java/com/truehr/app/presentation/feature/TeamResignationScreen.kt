package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.Resignation
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.NoTeamState
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*

private val TABS = listOf("PENDING" to "Pending", "APPROVED" to "Approved", "REJECTED" to "Rejected")

@Composable
fun TeamResignationScreen(onBack: () -> Unit, vm: ResignationViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  var tab by remember { mutableStateOf(0) }
  val s by vm.team.collectAsState()
  val prof by profileVm.state.collectAsState()
  val noTeam = prof.data?.isManager == false
  val reviewBusy by vm.reviewBusy.collectAsState()
  var rejectId by remember { mutableStateOf<Long?>(null) }
  LaunchedEffect(tab) { vm.loadTeam(TABS[tab].first) }

  rejectId?.let { id ->
    var note by remember { mutableStateOf("") }
    AlertDialog(
      onDismissRequest = { rejectId = null },
      title = { Text("Reject resignation") },
      text = {
        OutlinedTextField(note, { note = it }, label = { Text("Remark (optional)") }, minLines = 2,
          shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green), modifier = Modifier.fillMaxWidth())
      },
      confirmButton = { TextButton(onClick = { vm.review(id, "REJECTED", note.ifBlank { null }, TABS[tab].first); rejectId = null }) { Text("Reject", color = Rose) } },
      dismissButton = { TextButton(onClick = { rejectId = null }) { Text("Cancel") } },
    )
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Team Resignation", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    if (!noTeam) TabRow(selectedTabIndex = tab, containerColor = Surface, contentColor = Green) {
      TABS.forEachIndexed { i, (_, label) -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) }) }
    }
    when {
      noTeam -> NoTeamState()
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.loadTeam(TABS[tab].first) })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No ${TABS[tab].second.lowercase()} resignations.", color = InkSoft) }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(s.data!!) { r -> TeamResignationCard(r, showActions = tab == 0, busy = reviewBusy == r.id, onApprove = { vm.review(r.id, "APPROVED", null, TABS[tab].first) }, onReject = { rejectId = r.id }) }
      }
    }
  }
}

@Composable
private fun TeamResignationCard(r: Resignation, showActions: Boolean, busy: Boolean, onApprove: () -> Unit, onReject: () -> Unit) {
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
    Column(Modifier.padding(16.dp)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(r.name?.ifBlank { r.employeeCode } ?: r.employeeCode ?: "—", fontWeight = FontWeight.Bold, color = Sky, modifier = Modifier.weight(1f))
        r.appliedAt?.let { Text("Applied: ${dmy2(it)}", color = InkFaint, style = MaterialTheme.typography.labelSmall) }
      }
      Text("${r.designation ?: "—"} · ${r.employeeCode ?: ""}", color = Grape, style = MaterialTheme.typography.bodyMedium)
      HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 10.dp))
      KVL("Resignation date", r.resignationDate?.let { dmy2(it) })
      KVL("Last working date", r.lastWorkingDate?.let { dmy2(it) })
      KVL("Notice period", "${r.noticePeriodDays} days")
      if (!r.reason.isNullOrBlank()) KVL("Reason", r.reason)
      if (!r.reviewNote.isNullOrBlank()) KVL("Remark", r.reviewNote)
      if (showActions) {
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          OutlinedButton(onClick = onReject, enabled = !busy, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = Rose)) {
            Icon(Icons.Filled.Close, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Reject", fontWeight = FontWeight.SemiBold)
          }
          Button(onClick = onApprove, enabled = !busy, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.buttonColors(containerColor = Green, contentColor = Surface)) {
            if (busy) CircularProgressIndicator(color = Surface, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            else { Icon(Icons.Filled.Check, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Approve", fontWeight = FontWeight.SemiBold) }
          }
        }
      }
    }
  }
}

@Composable
private fun KVL(k: String, v: String?) {
  Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
    Text("$k:", color = InkFaint, modifier = Modifier.width(130.dp), style = MaterialTheme.typography.bodyMedium)
    Text(v?.takeIf { it.isNotBlank() } ?: "—", color = Ink, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
  }
}

private fun dmy2(iso: String): String {
  val p = iso.take(10).split("-")
  return if (p.size == 3) "${p[2]}/${p[1]}/${p[0]}" else iso
}
