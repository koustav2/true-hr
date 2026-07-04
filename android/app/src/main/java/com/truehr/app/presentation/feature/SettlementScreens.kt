package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountBalance
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.Settlement
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.theme.*

internal fun settlementStatusColor(status: String?): Color = when (status) {
  "CLOSE", "CLOSED" -> Green
  "IN_PROGRESS" -> Amber
  "REJECTED", "AUTO_REJECTED" -> Rose
  else -> InkFaint
}

// Settlement block shown on the NFA detail screen once payment is released.
// Owner can submit / resubmit; everyone sees the settlement chain.
@Composable
fun SettlementSection(nfaId: Long, settlementStatus: String?, isMine: Boolean, vm: EssViewModel = hiltViewModel()) {
  val s by vm.settlement.collectAsState()
  val busy by vm.settlementBusy.collectAsState()
  val error by vm.settlementError.collectAsState()
  var amount by remember { mutableStateOf("") }
  var remarks by remember { mutableStateOf("") }
  LaunchedEffect(nfaId) { vm.loadSettlement(nfaId) }

  InfoCard {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Icon(Icons.Filled.AccountBalance, null, tint = Green, modifier = Modifier.size(18.dp))
      Spacer(Modifier.width(8.dp))
      Text("Settlement", fontWeight = FontWeight.Bold, color = Ink)
      Spacer(Modifier.width(8.dp))
      Text(settlementStatus ?: "—", color = settlementStatusColor(settlementStatus), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
    }
    Spacer(Modifier.height(8.dp))

    val current = s.data
    if (current != null && current.status != "REJECTED") {
      InfoRow("Settlement amount", "₹${"%,.0f".format(current.amount)}")
      current.remarks?.let { InfoRow("Remarks", it) }
      current.approval?.chain?.forEach { st ->
        Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
          Text("${st.seq}. ${st.roleKey.replace('_', ' ')} — ${st.approverName ?: "—"}", color = InkSoft, style = MaterialTheme.typography.bodySmall)
          Text(st.status, color = settlementStatusColor(if (st.status == "APPROVED") "CLOSE" else st.status), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
      }
    } else if (isMine && (settlementStatus == "PENDING" || settlementStatus == "AUTO_REJECTED" || current?.status == "REJECTED")) {
      if (settlementStatus == "AUTO_REJECTED") {
        Text("Your settlement was auto-rejected by the system. Please resubmit.", color = Rose, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(8.dp))
      }
      AppTextField(amount, { amount = it.filter { c -> c.isDigit() || c == '.' } }, "Settlement amount")
      Spacer(Modifier.height(8.dp))
      AppTextField(remarks, { remarks = it }, "Remarks / expense proof notes")
      Spacer(Modifier.height(10.dp))
      error?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodySmall); Spacer(Modifier.height(6.dp)) }
      PrimaryButton(if (busy) "" else "Submit Your Settlement", loading = busy, onClick = {
        vm.submitSettlement(nfaId, amount.toDoubleOrNull(), remarks)
      }, modifier = Modifier.fillMaxWidth())
    } else {
      Text("No settlement submitted yet.", color = InkFaint, style = MaterialTheme.typography.bodySmall)
    }
  }
}

// Approver inbox for settlements (Rpt Mgr → Functional Head → Admin → Finance → Director → Closer).
@Composable
fun SettlementApprovalsScreen(onBack: () -> Unit, vm: EssViewModel = hiltViewModel()) {
  val inbox by vm.settlementInbox.collectAsState()
  val busy by vm.settlementBusy.collectAsState()
  val error by vm.settlementError.collectAsState()
  var acting by remember { mutableStateOf<Settlement?>(null) }
  var remarks by remember { mutableStateOf("") }
  LaunchedEffect(Unit) { vm.loadSettlementInbox() }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Settlement Approvals", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    error?.let { Text(it, color = Rose, modifier = Modifier.padding(14.dp)) }
    when {
      inbox.loading -> CenterLoader()
      inbox.error != null -> ErrorState(inbox.error!!) { vm.loadSettlementInbox() }
      inbox.data.isNullOrEmpty() -> NoTeamState("No settlements are waiting for your approval.")
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(inbox.data!!) { s ->
          Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp)) {
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(s.nfaCode ?: "Settlement #${s.id}", fontWeight = FontWeight.Bold, color = Green)
                Text("₹${"%,.0f".format(s.amount)}", fontWeight = FontWeight.Bold, color = Ink)
              }
              s.pendingStageRole?.let {
                Text("Waiting on you as ${it.replace('_', ' ')}", color = Amber, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
              }
              s.remarks?.let { Text("“$it”", color = InkFaint, style = MaterialTheme.typography.bodySmall) }
              Spacer(Modifier.height(8.dp))
              Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { vm.settlementAct(s.id, "APPROVED", null) }, enabled = !busy,
                  colors = ButtonDefaults.buttonColors(containerColor = Green)) { Text("Approve") }
                OutlinedButton(onClick = { acting = s }, enabled = !busy) { Text("Query / Reject") }
              }
            }
          }
        }
      }
    }
  }

  acting?.let { s ->
    AlertDialog(
      onDismissRequest = { acting = null },
      title = { Text("Settlement ${s.nfaCode ?: s.id}") },
      text = {
        Column {
          OutlinedTextField(remarks, { remarks = it }, label = { Text("Remarks (required)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
        }
      },
      confirmButton = {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          TextButton(onClick = { if (remarks.isNotBlank()) { vm.settlementAct(s.id, "QUERY_HOLD", remarks); acting = null; remarks = "" } }) { Text("Query") }
          TextButton(onClick = { if (remarks.isNotBlank()) { vm.settlementAct(s.id, "REJECTED", remarks); acting = null; remarks = "" } }) { Text("Reject", color = Rose) }
        }
      },
      dismissButton = { TextButton(onClick = { acting = null }) { Text("Cancel") } },
    )
  }
}
