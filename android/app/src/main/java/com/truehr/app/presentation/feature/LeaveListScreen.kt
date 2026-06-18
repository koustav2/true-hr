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
import com.truehr.app.presentation.theme.*

private val LV_TABS = listOf("PENDING" to "Pending", "APPROVED" to "Approved", "REJECTED" to "Rejected")

@Composable
fun LeaveListScreen(title: String, teamView: Boolean, onBack: () -> Unit, vm: LeaveViewModel = hiltViewModel()) {
  var tab by remember { mutableStateOf(0) }
  val s by vm.list.collectAsState()
  val reviewBusy by vm.reviewBusy.collectAsState()
  var rejectId by remember { mutableStateOf<Long?>(null) }
  LaunchedEffect(tab) { vm.load(LV_TABS[tab].first, teamView) }

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
    TabRow(selectedTabIndex = tab, containerColor = Surface, contentColor = Green) {
      LV_TABS.forEachIndexed { i, (_, label) -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) }) }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load(LV_TABS[tab].first, teamView) })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text("No ${LV_TABS[tab].second.lowercase()} requests.", color = InkSoft)
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
            onCancel = { vm.cancel(lr.id) },
          )
        }
      }
    }
  }
}

@Composable
private fun LeaveCard(lr: LeaveRequest, teamView: Boolean, showActions: Boolean, showCancel: Boolean, busy: Boolean, onApprove: () -> Unit, onReject: () -> Unit, onCancel: () -> Unit) {
  val statusColor = when (lr.status) { "APPROVED" -> Green; "REJECTED" -> Rose; else -> Amber }
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
        KVL("Total Days", "$days day(s)" + if (lr.halfDay) " · Half Day" else "")
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
        KVL("Duration", "${dmy(lr.fromDate)} - ${dmy(lr.toDate)} ($days day${if (days == "1") "" else "s"})" + if (lr.halfDay) " · Half Day" else "")
        KVL("Applied Date", lr.appliedAt?.let { dmy(it) } ?: "—")
        if (!lr.reason.isNullOrBlank()) KVL("Reason", lr.reason)
        KVL("Reporting Remark", lr.reviewNote?.takeIf { it.isNotBlank() } ?: if (lr.status == "PENDING") "Awaiting review" else "—")
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
    Text(status.lowercase().replaceFirstChar { it.uppercase() }, color = color,
      style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp))
  }
}

private fun fmtDaysOnly(d: Double): String = if (d == d.toLong().toDouble()) d.toLong().toString() else "%.1f".format(d)

// yyyy-MM-dd -> dd/MM/yyyy
private fun dmy(iso: String): String {
  val p = iso.take(10).split("-")
  return if (p.size == 3) "${p[2]}/${p[1]}/${p[0]}" else iso
}

@Composable
private fun KVL(k: String, v: String) {
  Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
    Text("$k:", color = InkFaint, modifier = Modifier.width(120.dp), style = MaterialTheme.typography.bodyMedium)
    Text(v, color = Ink, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
  }
}
