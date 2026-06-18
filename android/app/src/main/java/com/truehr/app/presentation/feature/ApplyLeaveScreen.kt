package com.truehr.app.presentation.feature

import android.util.Base64
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.LeaveBalance
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.PrimaryButton
import com.truehr.app.presentation.components.initials
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private val ISO_LV = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
private val STRIP = listOf("EL", "CL", "SL", "RH", "MH")
private val CHIP_COLORS = mapOf("EL" to Green, "CL" to Amber, "SL" to Rose, "RH" to Grape, "MH" to Pink)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApplyLeaveScreen(onBack: () -> Unit, vm: LeaveViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val ctx = LocalContext.current
  val p by profileVm.state.collectAsState()
  val bal by vm.balances.collectAsState()
  val types by vm.types.collectAsState()
  val submitting by vm.submitting.collectAsState()
  val applyError by vm.applyError.collectAsState()
  val applied by vm.applied.collectAsState()

  var leaveCode by remember { mutableStateOf("") }
  var typeOpen by remember { mutableStateOf(false) }
  // null = not chosen yet (half-day types start blank); "FULL" / "HALF" otherwise
  var duration by remember { mutableStateOf<String?>(null) }
  var fromDate by remember { mutableStateOf("") }
  var toDate by remember { mutableStateOf("") }
  var reason by remember { mutableStateOf("") }
  var certificate by remember { mutableStateOf<String?>(null) }
  var certMime by remember { mutableStateOf<String?>(null) }
  var certInfo by remember { mutableStateOf<String?>(null) }
  var picker by remember { mutableStateOf<String?>(null) }

  val selected = types.firstOrNull { it.code == leaveCode }
  val halfDay = duration == "HALF"
  val singleDate = selected?.singleDate == true || halfDay
  val showDates = duration != null
  val balances = bal.data ?: emptyList()
  val total = balances.filter { it.code in STRIP }.sumOf { it.remaining }

  LaunchedEffect(Unit) { vm.loadApplyData() }
  LaunchedEffect(applied) { if (applied) { delay(800); onBack() } }
  // Half-day types (CL/SL/MSL) start with NO duration chosen and hide dates until picked;
  // other types default to Full Day with dates shown immediately.
  LaunchedEffect(leaveCode) {
    duration = when {
      selected == null -> null
      selected.allowHalfDay -> null
      else -> "FULL"
    }
    fromDate = ""; toDate = ""
  }

  val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
    if (uri != null) {
      val bytes = runCatching { ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
      when {
        bytes == null -> certInfo = "Could not read file"
        bytes.size > 5 * 1024 * 1024 -> certInfo = "File too large (max 5MB)"
        else -> { certificate = Base64.encodeToString(bytes, Base64.NO_WRAP); certMime = ctx.contentResolver.getType(uri) ?: "application/octet-stream"; certInfo = "Attached (${bytes.size / 1024} KB)" }
      }
    }
  }

  if (picker != null) {
    val state = rememberDatePickerState()
    DatePickerDialog(
      onDismissRequest = { picker = null },
      confirmButton = {
        TextButton(onClick = {
          state.selectedDateMillis?.let { ms ->
            val v = ISO_LV.format(Date(ms))
            when (picker) {
              "FROM" -> { fromDate = v; if (toDate.isBlank() || toDate < v) toDate = v }
              "TO" -> toDate = v
              "SINGLE" -> { fromDate = v; toDate = v }
            }
          }
          picker = null
        }) { Text("OK") }
      },
      dismissButton = { TextButton(onClick = { picker = null }) { Text("Cancel") } },
    ) { DatePicker(state = state) }
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
          IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
          Text("Apply Leave", color = Surface, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
          Surface(color = Surface.copy(alpha = 0.18f), shape = RoundedCornerShape(10.dp), modifier = Modifier.clickable {
            Toast.makeText(ctx, "Comp-Off — coming soon", Toast.LENGTH_SHORT).show()
          }) {
            Text("Avail CompOff", color = Surface, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
          }
        }
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
          Box(Modifier.size(48.dp).clip(CircleShape).background(Surface.copy(alpha = 0.25f)), contentAlignment = Alignment.Center) {
            Text(initials(p.data?.fullName ?: "?"), color = Surface, fontWeight = FontWeight.Bold)
          }
          Spacer(Modifier.width(12.dp))
          Column {
            Text(p.data?.fullName ?: "—", color = Surface, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            Text(p.data?.designation ?: "", color = Surface.copy(alpha = 0.9f), style = MaterialTheme.typography.bodyMedium)
          }
        }
      }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      // Balance strip
      Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 2.dp) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          STRIP.forEach { code ->
            val b = balances.firstOrNull { it.code == code }
            BalanceChip(code, b?.remaining ?: 0.0, CHIP_COLORS[code] ?: Green, selected = leaveCode == code, modifier = Modifier.weight(1f))
          }
          Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(start = 4.dp)) {
            Text("Total", color = InkFaint, style = MaterialTheme.typography.labelSmall)
            Text(fmtL(total), color = Green, fontWeight = FontWeight.Black, style = MaterialTheme.typography.titleMedium)
          }
        }
      }

      Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 2.dp) {
        Column(Modifier.padding(16.dp)) {
          Text("Apply for Leave", fontWeight = FontWeight.Black, color = Ink, style = MaterialTheme.typography.titleLarge)
          Spacer(Modifier.height(14.dp))

          ExposedDropdownMenuBox(expanded = typeOpen, onExpandedChange = { typeOpen = it }) {
            OutlinedTextField(
              value = selected?.name ?: "", onValueChange = {}, readOnly = true, label = { Text("Leave Type") },
              trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(typeOpen) },
              shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
              modifier = Modifier.menuAnchor().fillMaxWidth(),
            )
            ExposedDropdownMenu(expanded = typeOpen, onDismissRequest = { typeOpen = false }) {
              types.forEach { t -> DropdownMenuItem(text = { Text(t.name) }, onClick = { leaveCode = t.code; typeOpen = false }) }
            }
          }
          // Availability line
          if (selected != null) {
            Spacer(Modifier.height(6.dp))
            val avail = balances.firstOrNull { it.code == leaveCode }
            Text(
              if (!selected.requiresBalance) "Balance Not Applicable" else "Available: ${fmtL(avail?.remaining ?: 0.0)} days",
              color = InkFaint, style = MaterialTheme.typography.bodyMedium,
            )
          }

          if (selected != null) {
            Spacer(Modifier.height(14.dp))
            Text("Apply for:", color = Ink, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(4.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
              Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { duration = "FULL" }) {
                RadioButton(selected = duration == "FULL", onClick = { duration = "FULL" }, colors = RadioButtonDefaults.colors(selectedColor = Green))
                Text("Full Day", color = Ink)
              }
              if (selected.allowHalfDay) {
                Spacer(Modifier.width(24.dp))
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { duration = "HALF" }) {
                  RadioButton(selected = duration == "HALF", onClick = { duration = "HALF" }, colors = RadioButtonDefaults.colors(selectedColor = Green))
                  Text("Half Day", color = Ink)
                }
              }
            }
          }

          // Sick-leave certificate
          if (selected?.allowCertificate == true) {
            Spacer(Modifier.height(12.dp))
            Text("Medical/sickness certificate is optional for Sick Leave.", color = Amber, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(8.dp))
            Surface(shape = RoundedCornerShape(12.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Line), color = Surface, modifier = Modifier.fillMaxWidth()) {
              Column(Modifier.padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(certInfo ?: "Upload Medical Certificate (Max 5MB)", color = if (certificate != null) Green else InkSoft, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { fileLauncher.launch("*/*") }, shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = Green)) {
                  Icon(Icons.Filled.UploadFile, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(if (certificate == null) "Add File" else "Replace")
                }
              }
            }
          }

          if (showDates) {
            Spacer(Modifier.height(14.dp))
            if (singleDate) {
              Text("Leave Date:", color = Ink, fontWeight = FontWeight.SemiBold)
              Spacer(Modifier.height(6.dp))
              LvDateField("Select Date", fromDate, Modifier.fillMaxWidth()) { picker = "SINGLE" }
            } else {
              Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f)) { Text("Start Date:", color = Ink, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(6.dp)); LvDateField("Select Start Date", fromDate, Modifier.fillMaxWidth()) { picker = "FROM" } }
                Column(Modifier.weight(1f)) { Text("End Date:", color = Ink, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(6.dp)); LvDateField("Select End Date", toDate, Modifier.fillMaxWidth()) { picker = "TO" } }
              }
            }
          }

          Spacer(Modifier.height(12.dp))
          OutlinedTextField(reason, { reason = it }, placeholder = { Text("Reason for Leave") }, minLines = 3,
            shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green), modifier = Modifier.fillMaxWidth())
        }
      }

      applyError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      if (applied) Text("Your leave request has been submitted.", color = Green, fontWeight = FontWeight.SemiBold)
      PrimaryButton(if (submitting) "" else "Submit Leave Request", loading = submitting, onClick = {
        if (selected == null) { Toast.makeText(ctx, "Select a leave type", Toast.LENGTH_SHORT).show() }
        else if (duration == null) { Toast.makeText(ctx, "Choose Full Day or Half Day", Toast.LENGTH_SHORT).show() }
        else vm.apply(leaveCode, fromDate, toDate, reason, halfDay, certificate, certMime)
      }, modifier = Modifier.fillMaxWidth())
      Spacer(Modifier.height(8.dp))
    }
  }
}

@Composable
private fun BalanceChip(code: String, value: Double, color: Color, selected: Boolean, modifier: Modifier = Modifier) {
  Surface(
    color = color.copy(alpha = 0.08f), shape = RoundedCornerShape(12.dp), modifier = modifier,
    border = androidx.compose.foundation.BorderStroke(if (selected) 2.dp else 1.dp, if (selected) color else Line),
  ) {
    Column(Modifier.padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Text(fmtL(value), color = color, fontWeight = FontWeight.Black, style = MaterialTheme.typography.titleSmall)
      Text(code, color = InkFaint, style = MaterialTheme.typography.labelSmall)
    }
  }
}

private fun fmtL(d: Double): String = if (d == d.toLong().toDouble()) d.toLong().toString() else "%.2f".format(d)

@Composable
private fun LvDateField(hint: String, value: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
  OutlinedTextField(
    value = value, onValueChange = {}, readOnly = true, enabled = false,
    placeholder = { Text(hint) },
    trailingIcon = { Icon(Icons.Filled.CalendarMonth, null, tint = InkFaint) },
    shape = RoundedCornerShape(12.dp),
    colors = OutlinedTextFieldDefaults.colors(
      disabledBorderColor = Line, disabledTextColor = Ink, disabledPlaceholderColor = InkFaint, disabledTrailingIconColor = InkFaint,
    ),
    modifier = modifier.clickable(onClick = onClick),
  )
}
