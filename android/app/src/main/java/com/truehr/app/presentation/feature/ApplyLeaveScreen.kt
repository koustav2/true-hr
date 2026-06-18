package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.EditCalendar
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.LeaveBalance
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.theme.*
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private val ISO_L = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApplyLeaveScreen(onBack: () -> Unit, vm: LeaveViewModel = hiltViewModel()) {
  val bal by vm.balances.collectAsState()
  val types by vm.types.collectAsState()
  val submitting by vm.submitting.collectAsState()
  val applyError by vm.applyError.collectAsState()
  val applied by vm.applied.collectAsState()

  var leaveCode by remember { mutableStateOf("") }
  var typeOpen by remember { mutableStateOf(false) }
  var fromDate by remember { mutableStateOf("") }
  var toDate by remember { mutableStateOf("") }
  var reason by remember { mutableStateOf("") }
  var picker by remember { mutableStateOf<String?>(null) }

  LaunchedEffect(Unit) { vm.loadApplyData() }
  LaunchedEffect(applied) { if (applied) { delay(800); onBack() } }

  if (picker != null) {
    val state = rememberDatePickerState()
    DatePickerDialog(
      onDismissRequest = { picker = null },
      confirmButton = {
        TextButton(onClick = {
          state.selectedDateMillis?.let { ms ->
            val v = ISO_L.format(Date(ms))
            if (picker == "FROM") { fromDate = v; if (toDate.isBlank() || toDate < v) toDate = v } else toDate = v
          }
          picker = null
        }) { Text("OK") }
      },
      dismissButton = { TextButton(onClick = { picker = null }) { Text("Cancel") } },
    ) { DatePicker(state = state) }
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Apply Leave", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      // Balances strip
      val balances = bal.data?.filter { it.requiresBalance } ?: emptyList()
      if (balances.isNotEmpty()) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          items(balances) { BalanceChip(it) }
        }
      }

      InfoCard {
        LeaveHeader(Icons.Filled.EditCalendar, "Leave Details")
        ExposedDropdownMenuBox(expanded = typeOpen, onExpandedChange = { typeOpen = it }) {
          OutlinedTextField(
            value = types.firstOrNull { it.code == leaveCode }?.name ?: "", onValueChange = {}, readOnly = true,
            label = { Text("Leave type") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(typeOpen) },
            shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
            modifier = Modifier.menuAnchor().fillMaxWidth(),
          )
          ExposedDropdownMenu(expanded = typeOpen, onDismissRequest = { typeOpen = false }) {
            types.forEach { t -> DropdownMenuItem(text = { Text(t.name) }, onClick = { leaveCode = t.code; typeOpen = false }) }
          }
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          LeaveDateField("From Date", fromDate, Modifier.weight(1f)) { picker = "FROM" }
          LeaveDateField("To Date", toDate, Modifier.weight(1f)) { picker = "TO" }
        }
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(reason, { reason = it }, label = { Text("Reason") }, minLines = 3,
          shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
          modifier = Modifier.fillMaxWidth())
      }
      applyError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      if (applied) Text("Your leave request has been submitted.", color = Green, fontWeight = FontWeight.SemiBold)
      PrimaryButton(if (submitting) "" else "Submit", loading = submitting, onClick = {
        vm.apply(leaveCode, fromDate, toDate, reason)
      }, modifier = Modifier.fillMaxWidth())
      Spacer(Modifier.height(8.dp))
    }
  }
}

@Composable
private fun BalanceChip(b: LeaveBalance) {
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Line)) {
    Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Text(fmt(b.remaining), color = Green, fontWeight = FontWeight.Black, style = MaterialTheme.typography.titleMedium)
      Text(b.code, color = InkFaint, style = MaterialTheme.typography.labelSmall)
    }
  }
}

private fun fmt(d: Double): String = if (d == d.toLong().toDouble()) d.toLong().toString() else "%.1f".format(d)

@Composable
private fun LeaveDateField(label: String, value: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
  OutlinedTextField(
    value = value, onValueChange = {}, readOnly = true, enabled = false, label = { Text(label) },
    trailingIcon = { Icon(Icons.Filled.CalendarMonth, null, tint = Green) },
    shape = RoundedCornerShape(12.dp),
    colors = OutlinedTextFieldDefaults.colors(
      disabledBorderColor = Line, disabledLabelColor = InkFaint, disabledTextColor = Ink, disabledTrailingIconColor = Green,
    ),
    modifier = modifier.fillMaxWidth().clickable(onClick = onClick),
  )
}

@Composable
private fun LeaveHeader(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Box(Modifier.size(34.dp).clip(CircleShape).background(Green.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
      Icon(icon, null, tint = Green, modifier = Modifier.size(18.dp))
    }
    Spacer(Modifier.width(10.dp))
    Text(title, fontWeight = FontWeight.Bold, color = Ink)
  }
  Spacer(Modifier.height(4.dp))
  HorizontalDivider(color = Line)
  Spacer(Modifier.height(10.dp))
}
