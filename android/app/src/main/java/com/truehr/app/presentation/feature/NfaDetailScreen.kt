package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*

private fun stageColor(status: String): Color = when (status) {
  "APPROVED" -> Green
  "REJECTED" -> Rose
  "QUERY" -> Color(0xFF0284C7)
  "PENDING" -> Amber
  "BYPASSED" -> InkFaint
  else -> InkFaint
}

// canAct = opened from the approvals inbox (I am the pending approver).
@Composable
fun NfaDetailScreen(id: Long, canAct: Boolean, onBack: () -> Unit, vm: NfaViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val detail by vm.detail.collectAsState()
  val actBusy by vm.actBusy.collectAsState()
  val actError by vm.actError.collectAsState()
  val p by profileVm.state.collectAsState()
  var remarks by remember { mutableStateOf("") }
  LaunchedEffect(id) { vm.loadDetail(id) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text(detail.data?.nfaCode ?: "NFA", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    when {
      detail.loading -> { CenterLoader(); return@Column }
      detail.error != null -> { ErrorState(detail.error!!) { vm.loadDetail(id) }; return@Column }
    }
    val d = detail.data ?: return@Column
    val isMine = p.data?.employeeCode != null && p.data?.employeeCode == d.employeeCode

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      InfoCard {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
          Surface(color = nfaStatusColor(d.status).copy(alpha = 0.12f), shape = RoundedCornerShape(50)) {
            Text(d.statusLabel, color = nfaStatusColor(d.status), style = MaterialTheme.typography.labelMedium,
              modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
          }
          Text("₹${"%,.0f".format(d.totals.grand)}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = Ink)
        }
      }

      InfoCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Icon(Icons.Filled.Badge, null, tint = Green, modifier = Modifier.size(18.dp))
          Spacer(Modifier.width(8.dp)); Text("NFA Details", fontWeight = FontWeight.Bold, color = Ink)
        }
        Spacer(Modifier.height(8.dp))
        InfoRow("Raised by", "${d.employeeName} (${d.employeeCode})")
        InfoRow("Raise for", d.raiseFor)
        InfoRow("Business operation", d.businessOperation)
        InfoRow("Cost to company", d.groupCompany)
        InfoRow("Project", d.project)
        InfoRow("Expense category", d.expenseCategory)
        InfoRow("Zone", d.zone)
        InfoRow("Location", d.location)
        InfoRow("Client / Vendor", d.clientVendor ?: "—")
        InfoRow("Payment type", d.paymentType.replace('_', ' '))
        InfoRow("Billable type", d.billableType.replace('_', ' '))
        d.billedState?.let { InfoRow("Billed state", it.replace('_', ' ')) }
        InfoRow("Settlement due", d.settlementDueDate ?: "—")
        InfoRow("Priority", d.priority)
        InfoRow("Purpose", d.purpose ?: "—")
        d.description?.let { InfoRow("Description", it) }
      }

      InfoCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Icon(Icons.Filled.ReceiptLong, null, tint = Green, modifier = Modifier.size(18.dp))
          Spacer(Modifier.width(8.dp)); Text("Expense Lines", fontWeight = FontWeight.Bold, color = Ink)
        }
        Spacer(Modifier.height(8.dp))
        d.lines.forEach { l ->
          Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
              Text(l.headerName, color = Ink, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
              l.subheaderName?.let { Text(it, color = InkFaint, style = MaterialTheme.typography.bodySmall) }
            }
            Text("₹${"%,.0f".format(l.totalAmount)}", color = Ink, fontWeight = FontWeight.SemiBold)
          }
        }
        HorizontalDivider(color = Line)
        Spacer(Modifier.height(8.dp))
        InfoRow("Total NFA", "₹${"%,.0f".format(d.totals.nfa)}")
        InfoRow("Total Logistic", "₹${"%,.0f".format(d.totals.logistic)}")
        InfoRow("Grand Total", "₹${"%,.0f".format(d.totals.grand)}")
      }

      d.approval?.let { a ->
        InfoCard {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.FactCheck, null, tint = Green, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp)); Text("Approval Chain", fontWeight = FontWeight.Bold, color = Ink)
          }
          Spacer(Modifier.height(8.dp))
          a.chain.forEach { s ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
              Column(Modifier.weight(1f)) {
                Text("${s.seq}. ${s.roleKey.replace('_', ' ')}", color = Ink, style = MaterialTheme.typography.bodyMedium)
                Text(s.approverName ?: "—", color = InkSoft, style = MaterialTheme.typography.bodySmall)
                s.remarks?.let { Text("“$it”", color = InkFaint, style = MaterialTheme.typography.bodySmall) }
              }
              Text(s.status, color = stageColor(s.status), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
            }
          }
        }
      }

      // Settlement cycle (opens after payment release — GreenHR "Submit Your Settlement")
      if (d.status == "PAYMENT_RELEASED") {
        SettlementSection(nfaId = d.id, settlementStatus = d.settlementStatus, isMine = isMine)
      }

      actError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }

      // Approver actions — server re-validates that I really am the current-stage approver.
      if (canAct && d.status == "PENDING") {
        InfoCard {
          Text("Your Decision", fontWeight = FontWeight.Bold, color = Ink)
          Spacer(Modifier.height(8.dp))
          OutlinedTextField(remarks, { remarks = it }, label = { Text("Remarks (required for query/reject)") }, minLines = 2,
            shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
            modifier = Modifier.fillMaxWidth())
          Spacer(Modifier.height(10.dp))
          Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = { vm.act(id, "APPROVED", remarks.ifBlank { null }) }, enabled = !actBusy,
              colors = ButtonDefaults.buttonColors(containerColor = Green), modifier = Modifier.weight(1f)) { Text("Approve") }
            OutlinedButton(onClick = { if (remarks.isNotBlank()) vm.act(id, "QUERY_HOLD", remarks) }, enabled = !actBusy, modifier = Modifier.weight(1f)) { Text("Query") }
            Button(onClick = { if (remarks.isNotBlank()) vm.act(id, "REJECTED", remarks) }, enabled = !actBusy,
              colors = ButtonDefaults.buttonColors(containerColor = Rose), modifier = Modifier.weight(1f)) { Text("Reject") }
          }
        }
      }

      // Raiser answers a query.
      if (isMine && d.status == "QUERY") {
        InfoCard {
          Text("Answer Query & Resubmit", fontWeight = FontWeight.Bold, color = Ink)
          Spacer(Modifier.height(8.dp))
          OutlinedTextField(remarks, { remarks = it }, label = { Text("Reply to the query") }, minLines = 2,
            shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
            modifier = Modifier.fillMaxWidth())
          Spacer(Modifier.height(10.dp))
          PrimaryButton(if (actBusy) "" else "Resubmit", loading = actBusy, onClick = { vm.resubmit(id, remarks) }, modifier = Modifier.fillMaxWidth())
        }
      }
      Spacer(Modifier.height(8.dp))
    }
  }
}
