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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.MissPunch
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ConfirmDialog
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.NoTeamState
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*

private val TABS = listOf("PENDING" to "Pending", "APPROVED" to "Approved", "REJECTED" to "Rejected", "CANCELLED" to "Cancelled")

@Composable
fun MissPunchListScreen(title: String, teamView: Boolean, onBack: () -> Unit, vm: MissPunchViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  var tab by remember { mutableStateOf(0) }
  val s by vm.list.collectAsState()
  val prof by profileVm.state.collectAsState()
  val noTeam = teamView && prof.data?.isManager == false
  val reviewBusy by vm.reviewBusy.collectAsState()
  var rejectId by remember { mutableStateOf<Long?>(null) }
  var cancelId by remember { mutableStateOf<Long?>(null) }
  val tabs = if (teamView) TABS.take(3) else TABS
  LaunchedEffect(tab) { vm.load(tabs[tab].first, teamView) }

  cancelId?.let { id ->
    ConfirmDialog(
      title = "Cancel this request?", body = "Your miss-punch request will be withdrawn.",
      confirmLabel = "Cancel request", dismissLabel = "Keep it",
      onConfirm = { vm.cancel(id); cancelId = null }, onDismiss = { cancelId = null },
    )
  }

  rejectId?.let { id ->
    var note by remember { mutableStateOf("") }
    AlertDialog(
      onDismissRequest = { rejectId = null },
      title = { Text("Reject request") },
      text = {
        Column {
          Text("Add a note for the employee (optional).", color = InkSoft, style = MaterialTheme.typography.bodyMedium)
          Spacer(Modifier.height(10.dp))
          OutlinedTextField(note, { note = it }, label = { Text("Note") }, minLines = 2,
            shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
            modifier = Modifier.fillMaxWidth())
        }
      },
      confirmButton = { TextButton(onClick = { vm.review(id, "REJECTED", note.ifBlank { null }); rejectId = null }) { Text("Reject", color = Rose) } },
      dismissButton = { TextButton(onClick = { rejectId = null }) { Text("Cancel") } },
    )
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text(title, color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    if (!noTeam) ScrollableTabRow(selectedTabIndex = tab, containerColor = Surface, contentColor = Green, edgePadding = 8.dp) {
      tabs.forEachIndexed { i, (_, label) ->
        Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) })
      }
    }
    when {
      noTeam -> NoTeamState()
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load(tabs[tab].first, teamView) })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text("No ${tabs[tab].second.lowercase()} requests.", color = InkSoft)
      }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(s.data!!) { m ->
          MissPunchCard(
            m,
            showActions = teamView && m.status == "PENDING",
            busy = reviewBusy == m.id,
            onApprove = { vm.review(m.id, "APPROVED", null) },
            onReject = { rejectId = m.id },
            showCancel = !teamView && m.status == "PENDING",
            onCancel = { cancelId = m.id },
          )
        }
      }
    }
  }
}

@Composable
private fun MissPunchCard(m: MissPunch, showActions: Boolean = false, busy: Boolean = false, onApprove: () -> Unit = {}, onReject: () -> Unit = {}, showCancel: Boolean = false, onCancel: () -> Unit = {}) {
  val statusColor = when (m.status) { "APPROVED" -> Green; "REJECTED" -> Rose; "CANCELLED" -> InkFaint; else -> Amber }
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
    Column(Modifier.padding(16.dp)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Column {
          Text(m.name, fontWeight = FontWeight.Bold, color = Ink)
          Text("Emp Code: ${m.employeeCode}", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
        }
        Surface(color = statusColor.copy(alpha = 0.12f), shape = RoundedCornerShape(20.dp)) {
          Text(com.truehr.app.core.Labels.of(m.status), color = statusColor,
            style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
        }
      }
      HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 10.dp))
      KV("Request Date", m.days)
      KV("Month", m.month)
      KV("Year", m.year.toString())
      if (m.inTime != null || m.outTime != null) KV("In / Out", "${m.inTime ?: "—"} – ${m.outTime ?: "—"}")
      KV("Apply Date", m.appliedAt?.let { com.truehr.app.core.Dates.dmy(it) } ?: "—")
      if (m.status == "PENDING" && m.pendingWith != null) KV("Pending with", m.pendingWith)
      if (m.status == "CANCELLED") KV("Cancelled on", com.truehr.app.core.Dates.dmyTime(m.cancelledAt))
      else if (m.reviewedAt != null) KV("Reviewed On", com.truehr.app.core.Dates.dmy(m.reviewedAt) + (m.reviewedBy?.let { " by $it" } ?: ""))
      if (!m.remarks.isNullOrBlank()) KV("Remarks", m.remarks)
      if (!m.reviewNote.isNullOrBlank()) KV("Review Note", m.reviewNote)

      if (showCancel) {
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onCancel, enabled = !busy, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp),
          colors = ButtonDefaults.outlinedButtonColors(contentColor = Rose)) { Text("Cancel Request", fontWeight = FontWeight.SemiBold) }
      }
      if (showActions) {
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          OutlinedButton(
            onClick = onReject, enabled = !busy, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Rose),
          ) {
            Icon(Icons.Filled.Close, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Reject", fontWeight = FontWeight.SemiBold)
          }
          Button(
            onClick = onApprove, enabled = !busy, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Green, contentColor = Surface),
          ) {
            if (busy) CircularProgressIndicator(color = Surface, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            else { Icon(Icons.Filled.Check, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Approve", fontWeight = FontWeight.SemiBold) }
          }
        }
      }
    }
  }
}

@Composable
private fun KV(k: String, v: String) {
  Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
    Text(k, color = InkFaint, modifier = Modifier.width(120.dp), style = MaterialTheme.typography.bodyMedium)
    Text(v, color = Ink, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
  }
}
