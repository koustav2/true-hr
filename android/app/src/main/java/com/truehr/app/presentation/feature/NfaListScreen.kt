package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.NfaRow
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.theme.*

internal fun nfaStatusColor(status: String): Color = when (status) {
  "APPROVED", "PAYMENT_RELEASED" -> Green
  "REJECTED" -> Rose
  "QUERY" -> Color(0xFF0284C7)
  else -> Amber
}

// One list screen for both "My NFAs" (inbox = false) and the approver inbox (inbox = true).
private val STATUS_FILTERS = listOf(
  null to "All", "PENDING" to "Pending", "QUERY" to "Query",
  "APPROVED" to "Approved", "PAYMENT_RELEASED" to "Released", "REJECTED" to "Rejected",
)

@Composable
fun NfaListScreen(title: String, inbox: Boolean, onBack: () -> Unit, onOpen: (Long, Boolean) -> Unit, vm: NfaViewModel = hiltViewModel()) {
  val state by (if (inbox) vm.pending else vm.list).collectAsState()
  var status by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(status) { if (inbox) vm.loadPending() else vm.loadList(null, null, status) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text(title, color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    if (!inbox) {
      androidx.compose.foundation.lazy.LazyRow(
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        items(STATUS_FILTERS) { (value, label) ->
          val active = status == value
          Surface(
            color = if (active) Green.copy(alpha = 0.14f) else Surface,
            shape = RoundedCornerShape(50),
            shadowElevation = if (active) 0.dp else 1.dp,
            modifier = Modifier.clickable { status = value },
          ) {
            Text(label, color = if (active) Green else InkSoft, style = MaterialTheme.typography.labelMedium,
              fontWeight = if (active) FontWeight.Bold else FontWeight.Medium,
              modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp))
          }
        }
      }
    }
    when {
      state.loading -> CenterLoader()
      state.error != null -> ErrorState(state.error!!) { if (inbox) vm.loadPending() else vm.loadList(null, null, null) }
      state.data.isNullOrEmpty() -> NoTeamState(if (inbox) "No NFAs are waiting for your approval." else "You haven't raised any NFAs yet.")
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(state.data!!) { r -> NfaRowCard(r, inbox) { onOpen(r.id, inbox) } }
      }
    }
  }
}

@Composable
private fun NfaRowCard(r: NfaRow, inbox: Boolean, onClick: () -> Unit) {
  Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
    Column(Modifier.clickable(onClick = onClick).padding(14.dp)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Text(r.nfaCode, fontWeight = FontWeight.Bold, color = Green)
        Surface(color = nfaStatusColor(r.status).copy(alpha = 0.12f), shape = RoundedCornerShape(50)) {
          Text(r.status.replace('_', ' '), color = nfaStatusColor(r.status), style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp))
        }
      }
      Spacer(Modifier.height(6.dp))
      if (inbox) Text("${r.employeeName} · ${r.employeeCode}", color = Ink, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
      Text("${r.projectName} · ${r.expenseCategoryName}", color = InkSoft, style = MaterialTheme.typography.bodySmall)
      Spacer(Modifier.height(6.dp))
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(r.paymentType.replace('_', ' '), color = InkFaint, style = MaterialTheme.typography.labelSmall)
        Text("₹${"%,.0f".format(r.totals.grand)}", color = Ink, fontWeight = FontWeight.Bold)
      }
      if (inbox && r.pendingStageRole != null) {
        Spacer(Modifier.height(4.dp))
        Text("Waiting on you as ${r.pendingStageRole!!.replace('_', ' ')}", color = Amber, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
      }
    }
  }
}
