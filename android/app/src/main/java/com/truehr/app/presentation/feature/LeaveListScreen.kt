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
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material3.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.LeaveRequest
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.NoTeamState
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*

private val LV_TABS = listOf("PENDING" to "Pending", "APPROVED" to "Approved", "REJECTED" to "Rejected", "CANCELLED" to "Cancelled")

@Composable
fun LeaveListScreen(title: String, teamView: Boolean, onBack: () -> Unit, vm: LeaveViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  var tab by remember { mutableStateOf(0) }
  val s by vm.list.collectAsState()
  val prof by profileVm.state.collectAsState()
  val noTeam = teamView && prof.data?.isManager == false
  val reviewBusy by vm.reviewBusy.collectAsState()
  var rejectId by remember { mutableStateOf<Long?>(null) }
  var cancelId by remember { mutableStateOf<Long?>(null) }
  val actionError by vm.actionError.collectAsState()
  val tabs = if (teamView) LV_TABS.take(3) else LV_TABS
  LaunchedEffect(tab) { vm.load(tabs[tab].first, teamView) }

  // E15: cancelling asks first.
  cancelId?.let { id ->
    com.truehr.app.presentation.components.ConfirmDialog(
      title = "Cancel this leave?",
      body = "Your request will be withdrawn and the days returned to your balance.",
      confirmLabel = "Cancel leave", dismissLabel = "Keep it",
      onConfirm = { vm.cancel(id); cancelId = null }, onDismiss = { cancelId = null },
    )
  }

  rejectId?.let { id ->
    var note by remember { mutableStateOf("") }
    AlertDialog(
      onDismissRequest = { rejectId = null },
      title = { Text("Reject leave") },
      text = {
        Column {
          Text("Add a remark for the employee (optional).", color = InkSoft, style = MaterialTheme.typography.bodyMedium)
          Spacer(Modifier.height(10.dp))
          OutlinedTextField(note, { note = it }, label = { Text("Remark") }, minLines = 2,
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
    actionError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) }
    if (!noTeam) ScrollableTabRow(selectedTabIndex = tab, containerColor = Surface, contentColor = Green, edgePadding = 8.dp) {
      tabs.forEachIndexed { i, (_, label) -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) }) }
    }
    when {
      noTeam -> NoTeamState()
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load(tabs[tab].first, teamView) })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text("No ${tabs[tab].second.lowercase()} requests.", color = InkSoft)
      }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(s.data!!) { lr ->
          LeaveCard(
            lr,
            teamView = teamView,
            showActions = teamView && lr.status == "PENDING",
            showCancel = !teamView && lr.status == "PENDING",
            busy = reviewBusy == lr.id,
            onApprove = { vm.review(lr.id, "APPROVED", null) },
            onReject = { rejectId = lr.id },
            onCancel = { cancelId = lr.id },
          )
        }
      }
    }
  }
}

@Composable
private fun LeaveCard(lr: LeaveRequest, teamView: Boolean, showActions: Boolean, showCancel: Boolean, busy: Boolean, onApprove: () -> Unit, onReject: () -> Unit, onCancel: () -> Unit) {
  val statusColor = when (lr.status) { "APPROVED" -> Green; "REJECTED" -> Rose; "CANCELLED" -> InkFaint; else -> Amber }
  val half = if (lr.halfDay) " · " + (lr.halfDaySession?.let { com.truehr.app.core.Labels.of(it) } ?: "Half day") else ""
  val days = fmtDaysOnly(lr.days)
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
    Column(Modifier.padding(16.dp)) {
      if (teamView) {
        // ---- Team Leave layout ----
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          Text(lr.name.ifBlank { lr.employeeCode }, fontWeight = FontWeight.Bold, color = Sky, modifier = Modifier.weight(1f))
          lr.appliedAt?.let { Text("Applied: ${dmy(it)}", color = InkFaint, style = MaterialTheme.typography.labelSmall) }
        }
        Text(lr.leaveType, color = Grape, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
        HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 10.dp))
        KVL("Duration", "($days) ${dmy(lr.fromDate)} - ${dmy(lr.toDate)}")
        KVL("Total Days", "$days day(s)$half")
        if (!lr.reason.isNullOrBlank()) KVL("Reason", lr.reason)
        Certificate(lr)
        Spacer(Modifier.height(10.dp))
        Text("Approvals:", color = Ink, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text("R.M. Status: ", color = Ink, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
          StatusPill(lr.status, statusColor)
        }
        if (!lr.reviewNote.isNullOrBlank()) { Spacer(Modifier.height(6.dp)); KVL("R.M. Remark", lr.reviewNote) }
      } else {
        // ---- View Leave (own) layout ----
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
          Text("Employee: ${lr.employeeCode}", fontWeight = FontWeight.Bold, color = Ink, modifier = Modifier.weight(1f))
          StatusPill(lr.status, statusColor)
        }
        HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 10.dp))
        KVL("Leave Type", lr.leaveType)
        KVL("Duration", "${dmy(lr.fromDate)} - ${dmy(lr.toDate)} ($days day${if (days == "1") "" else "s"})$half")
        KVL("Applied Date", lr.appliedAt?.let { dmy(it) } ?: "—")
        if (!lr.reason.isNullOrBlank()) KVL("Reason", lr.reason)
        // E9: who it waits with (HR when there is no reporting manager).
        if (lr.status == "PENDING") KVL("Pending with", lr.pendingWith ?: "Your reporting manager")
        if (lr.status in setOf("APPROVED", "REJECTED") && !lr.reviewedBy.isNullOrBlank()) KVL("${com.truehr.app.core.Labels.of(lr.status)} by", lr.reviewedBy)
        // E15: when and by whom it was cancelled.
        if (lr.status == "CANCELLED") {
          KVL("Cancelled on", com.truehr.app.core.Dates.dmyTime(lr.cancelledAt ?: lr.reviewedAt))
          KVL("Cancelled by", lr.cancelledBy ?: "—")
        }
        if (!lr.reviewNote.isNullOrBlank()) KVL("Remark", lr.reviewNote)
        Certificate(lr)
      }

      if (showActions) {
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          OutlinedButton(onClick = onReject, enabled = !busy, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Rose)) {
            Icon(Icons.Filled.Close, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Reject", fontWeight = FontWeight.SemiBold)
          }
          Button(onClick = onApprove, enabled = !busy, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Green, contentColor = Surface)) {
            if (busy) CircularProgressIndicator(color = Surface, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            else { Icon(Icons.Filled.Check, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Approve", fontWeight = FontWeight.SemiBold) }
          }
        }
      }
      if (showCancel) {
        Spacer(Modifier.height(12.dp))
        OutlinedButton(onClick = onCancel, enabled = !busy, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp),
          colors = ButtonDefaults.outlinedButtonColors(contentColor = Rose)) {
          if (busy) CircularProgressIndicator(color = Rose, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
          else { Icon(Icons.Filled.DeleteOutline, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text("Cancel Request", fontWeight = FontWeight.SemiBold) }
        }
      }
    }
  }
}

@Composable
private fun Certificate(lr: LeaveRequest) {
  if (lr.hasCertificate && lr.certificateUrl != null) {
    Spacer(Modifier.height(8.dp))
    Text("Medical certificate", color = InkFaint, style = MaterialTheme.typography.labelSmall)
    Spacer(Modifier.height(4.dp))
    AsyncImage(model = lr.certificateUrl, contentDescription = "Medical certificate", contentScale = ContentScale.Crop,
      modifier = Modifier.size(width = 120.dp, height = 90.dp).clip(RoundedCornerShape(10.dp)))
  }
}

@Composable
private fun StatusPill(status: String, color: androidx.compose.ui.graphics.Color) {
  Surface(color = color.copy(alpha = 0.14f), shape = RoundedCornerShape(20.dp)) {
    Text(com.truehr.app.core.Labels.of(status), color = color,
      style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp))
  }
}

private fun fmtDaysOnly(d: Double): String = if (d == d.toLong().toDouble()) d.toLong().toString() else "%.1f".format(d)

private fun dmy(iso: String): String = com.truehr.app.core.Dates.dmy(iso)

@Composable
private fun KVL(k: String, v: String) {
  Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
    Text("$k:", color = InkFaint, modifier = Modifier.width(120.dp), style = MaterialTheme.typography.bodyMedium)
    Text(v, color = Ink, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
  }
}
