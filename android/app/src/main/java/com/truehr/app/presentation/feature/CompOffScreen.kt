package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.CompOffRequest
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private val ISO_CO = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
private val CO_TABS = listOf("PENDING" to "Pending", "APPROVED" to "Approved", "REJECTED" to "Rejected")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CompOffScreen(title: String, teamView: Boolean, onBack: () -> Unit, vm: CompOffViewModel = hiltViewModel()) {
  var tab by remember { mutableStateOf(0) }
  val s by vm.list.collectAsState()
  val reviewBusy by vm.reviewBusy.collectAsState()
  var rejectId by remember { mutableStateOf<Long?>(null) }
  var showApply by remember { mutableStateOf(false) }

  LaunchedEffect(tab) { vm.load(CO_TABS[tab].first, teamView) }
  LaunchedEffect(Unit) { if (!teamView) vm.loadCredits() }

  rejectId?.let { id ->
    var note by remember { mutableStateOf("") }
    AlertDialog(
      onDismissRequest = { rejectId = null },
      title = { Text("Reject comp-off") },
      text = {
        OutlinedTextField(note, { note = it }, label = { Text("Remark (optional)") }, minLines = 2,
          shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green), modifier = Modifier.fillMaxWidth())
      },
      confirmButton = { TextButton(onClick = { vm.review(id, "REJECTED", note.ifBlank { null }); rejectId = null }) { Text("Reject", color = Rose) } },
      dismissButton = { TextButton(onClick = { rejectId = null }) { Text("Cancel") } },
    )
  }

  if (showApply) ApplyCompOffDialog(vm) { showApply = false }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text(title, color = Surface, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        if (!teamView) Surface(color = Surface.copy(alpha = 0.18f), shape = RoundedCornerShape(10.dp), modifier = Modifier.clickable { showApply = true }) {
          Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Add, null, tint = Surface, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(4.dp))
            Text("Avail", color = Surface, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelMedium)
          }
        }
      }
    }
    TabRow(selectedTabIndex = tab, containerColor = Surface, contentColor = Green) {
      CO_TABS.forEachIndexed { i, (_, label) -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) }) }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load(CO_TABS[tab].first, teamView) })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text("No ${CO_TABS[tab].second.lowercase()} comp-off requests.", color = InkSoft)
      }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(s.data!!) { co ->
          CompOffCard(co, showActions = teamView && co.status == "PENDING", busy = reviewBusy == co.id,
            onApprove = { vm.review(co.id, "APPROVED", null) }, onReject = { rejectId = co.id })
        }
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ApplyCompOffDialog(vm: CompOffViewModel, onClose: () -> Unit) {
  val credits by vm.credits.collectAsState()
  val submitting by vm.submitting.collectAsState()
  val applyError by vm.applyError.collectAsState()
  val applied by vm.applied.collectAsState()
  var creditOpen by remember { mutableStateOf(false) }
  var selectedOd by remember { mutableStateOf<Long?>(null) }
  var leaveDate by remember { mutableStateOf("") }
  var remark by remember { mutableStateOf("") }
  var datePicker by remember { mutableStateOf(false) }

  LaunchedEffect(applied) { if (applied) { vm.resetApplied(); onClose() } }

  val chosen = credits.firstOrNull { it.onDutyId == selectedOd }

  if (datePicker) {
    val state = rememberDatePickerState()
    DatePickerDialog(
      onDismissRequest = { datePicker = false },
      confirmButton = { TextButton(onClick = { state.selectedDateMillis?.let { leaveDate = ISO_CO.format(Date(it)) }; datePicker = false }) { Text("OK") } },
      dismissButton = { TextButton(onClick = { datePicker = false }) { Text("Cancel") } },
    ) { DatePicker(state = state) }
  }

  AlertDialog(
    onDismissRequest = onClose,
    title = { Text("Avail Comp-Off") },
    text = {
      Column {
        if (credits.isEmpty()) {
          Text("No comp-off credits available. Get an OD approved first to earn a comp-off.", color = InkSoft, style = MaterialTheme.typography.bodyMedium)
        } else {
          ExposedDropdownMenuBox(expanded = creditOpen, onExpandedChange = { creditOpen = it }) {
            OutlinedTextField(
              value = chosen?.let { "OD ${it.workedFrom} · exp ${it.expiryDate}" } ?: "", onValueChange = {}, readOnly = true,
              label = { Text("OD credit") }, trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(creditOpen) },
              shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
              modifier = Modifier.menuAnchor().fillMaxWidth())
            ExposedDropdownMenu(expanded = creditOpen, onDismissRequest = { creditOpen = false }) {
              credits.forEach { c -> DropdownMenuItem(text = { Text("OD ${c.workedFrom}  (expires ${c.expiryDate})") }, onClick = { selectedOd = c.onDutyId; creditOpen = false }) }
            }
          }
          Spacer(Modifier.height(10.dp))
          OutlinedTextField(value = leaveDate, onValueChange = {}, readOnly = true, enabled = false, label = { Text("Leave Date") },
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(disabledBorderColor = Line, disabledLabelColor = InkFaint, disabledTextColor = Ink),
            modifier = Modifier.fillMaxWidth().clickable { datePicker = true })
          Spacer(Modifier.height(10.dp))
          OutlinedTextField(remark, { remark = it }, label = { Text("Remark") }, minLines = 2,
            shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green), modifier = Modifier.fillMaxWidth())
          applyError?.let { Spacer(Modifier.height(8.dp)); Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
        }
      }
    },
    confirmButton = {
      if (credits.isNotEmpty()) TextButton(enabled = !submitting, onClick = { vm.apply(selectedOd ?: 0L, leaveDate, remark) }) { Text("Submit", color = Green, fontWeight = FontWeight.Bold) }
      else TextButton(onClick = onClose) { Text("Close") }
    },
    dismissButton = { if (credits.isNotEmpty()) TextButton(onClick = onClose) { Text("Cancel") } },
  )
}

@Composable
private fun CompOffCard(co: CompOffRequest, showActions: Boolean, busy: Boolean, onApprove: () -> Unit, onReject: () -> Unit) {
  val statusColor = when (co.status) { "APPROVED" -> Green; "REJECTED" -> Rose; else -> Amber }
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
    Column(Modifier.padding(16.dp)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text(co.name.ifBlank { co.employeeCode }, fontWeight = FontWeight.Bold, color = Ink)
          Text("Emp Code: ${co.employeeCode}", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
        }
        Surface(color = statusColor.copy(alpha = 0.14f), shape = RoundedCornerShape(20.dp)) {
          Text(co.status.lowercase().replaceFirstChar { it.uppercase() }, color = statusColor,
            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
        }
      }
      HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 10.dp))
      KVc("Dates", "${co.workedFrom} to ${co.workedTo}")
      if (!co.location.isNullOrBlank()) KVc("Location", co.location)
      KVc("OD Balance", co.odBalance.toString())
      KVc("Leave Date", co.leaveDate)
      KVc("Expiry Date", co.expiryDate)
      if (!co.remark.isNullOrBlank()) KVc("Remark", co.remark)
      if (!co.reviewNote.isNullOrBlank()) KVc("Remark (RM)", co.reviewNote)

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
    }
  }
}

@Composable
private fun KVc(k: String, v: String) {
  Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
    Text("$k:", color = InkFaint, modifier = Modifier.width(110.dp), style = MaterialTheme.typography.bodyMedium)
    Text(v, color = Ink, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
  }
}
