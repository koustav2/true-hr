package com.truehr.app.presentation.feature

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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.core.Dates
import com.truehr.app.core.launchSafely
import com.truehr.app.core.readPickedFile
import com.truehr.app.domain.model.LeaveBalance
import com.truehr.app.presentation.components.FieldError
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.PrimaryButton
import com.truehr.app.presentation.components.initials
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val CHIP_COLORS = listOf(Green, Amber, Rose, Grape, Pink, Sky, Teal)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApplyLeaveScreen(onBack: () -> Unit, onAvailCompOff: () -> Unit = {}, onHolidays: () -> Unit = {}, vm: LeaveViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val ctx = LocalContext.current
  val scope = rememberCoroutineScope()
  val p by profileVm.state.collectAsState()
  val bal by vm.balances.collectAsState()
  val types by vm.types.collectAsState()
  val holidays by vm.holidays.collectAsState()
  val submitting by vm.submitting.collectAsState()
  val applyError by vm.applyError.collectAsState()
  val errors by vm.fieldErrors.collectAsState()
  val applied by vm.applied.collectAsState()

  var leaveCode by rememberSaveable { mutableStateOf("") }
  var typeOpen by remember { mutableStateOf(false) }
  var duration by rememberSaveable { mutableStateOf("FULL") }      // FULL | HALF
  var session by rememberSaveable { mutableStateOf<String?>(null) } // FIRST | SECOND
  var fromDate by rememberSaveable { mutableStateOf("") }
  var toDate by rememberSaveable { mutableStateOf("") }
  var reason by rememberSaveable { mutableStateOf("") }
  var certificate by remember { mutableStateOf<String?>(null) }
  var certMime by remember { mutableStateOf<String?>(null) }
  var certName by remember { mutableStateOf<String?>(null) }
  var certInfo by remember { mutableStateOf<String?>(null) }
  var picker by remember { mutableStateOf<String?>(null) }
  var rhOpen by remember { mutableStateOf(false) }

  val selected = types.firstOrNull { it.code == leaveCode }
  val halfDay = duration == "HALF"
  val isRh = selected?.code == "RH"
  val singleDate = selected?.singleDate == true || halfDay || isRh
  val balances = bal.data ?: emptyList()
  val today = remember { Dates.todayIso() }
  val rhList = holidays.filter { it.restricted && it.date >= today }

  LaunchedEffect(Unit) { vm.loadApplyData() }
  LaunchedEffect(applied) { if (applied != null) { delay(1500); onBack() } }
  // A new type starts clean (half day only where the type allows it).
  var lastCode by rememberSaveable { mutableStateOf("") }
  LaunchedEffect(leaveCode) {
    if (leaveCode != lastCode) {
      if (lastCode.isNotEmpty()) { duration = "FULL"; session = null; fromDate = ""; toDate = "" }
      lastCode = leaveCode
    }
  }

  val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
    if (uri != null) scope.launch {
      readPickedFile(ctx, uri).onSuccess { f ->
        certificate = f.base64; certMime = f.mime; certName = f.name; certInfo = "${f.name} (${f.sizeKb} KB)"; vm.clearFieldError("certificate")
      }.onFailure { certInfo = it.message }
    }
  }

  if (picker != null) {
    val initial = Dates.toPickerMillis(if (picker == "TO") toDate.ifBlank { fromDate } else fromDate)
    val state = rememberDatePickerState(initialSelectedDateMillis = initial)
    DatePickerDialog(
      onDismissRequest = { picker = null },
      confirmButton = {
        TextButton(onClick = {
          state.selectedDateMillis?.let { ms ->
            val v = Dates.fromPickerMillis(ms)
            when (picker) {
              "FROM" -> { fromDate = v; if (toDate.isBlank() || toDate < v) toDate = v; vm.clearFieldError("fromDate") }
              "TO" -> { toDate = v; vm.clearFieldError("toDate") }
              "SINGLE" -> { fromDate = v; toDate = v; vm.clearFieldError("fromDate"); vm.clearFieldError("toDate"); vm.clearFieldError("halfDay") }
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
          Surface(color = Surface.copy(alpha = 0.18f), shape = RoundedCornerShape(10.dp), modifier = Modifier.clickable { onAvailCompOff() }) {
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
      bal.error?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      // E13: balances after pending requests (what you can actually apply for now).
      if (balances.isNotEmpty()) {
        Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 2.dp) {
          Column(Modifier.padding(12.dp)) {
            Text("Available balance (after pending requests)", color = InkFaint, style = MaterialTheme.typography.labelMedium)
            Spacer(Modifier.height(8.dp))
            balances.chunked(4).forEachIndexed { row, chunk ->
              Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                chunk.forEachIndexed { i, b ->
                  BalanceChip(b, CHIP_COLORS[(row * 4 + i) % CHIP_COLORS.size], leaveCode == b.code, Modifier.weight(1f)) { leaveCode = b.code; vm.clearFieldError("leaveCode") }
                }
                repeat(4 - chunk.size) { Spacer(Modifier.weight(1f)) }
              }
              Spacer(Modifier.height(8.dp))
            }
          }
        }
      }

      Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 2.dp) {
        Column(Modifier.padding(16.dp)) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Apply for Leave", fontWeight = FontWeight.Black, color = Ink, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            TextButton(onClick = onHolidays) { Text("Holiday list", color = Green) }
          }
          Spacer(Modifier.height(10.dp))

          ExposedDropdownMenuBox(expanded = typeOpen, onExpandedChange = { typeOpen = it }) {
            OutlinedTextField(
              value = selected?.name ?: "", onValueChange = {}, readOnly = true, label = { Text("Leave type *") },
              trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(typeOpen) }, isError = errors["leaveCode"] != null,
              shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
              modifier = Modifier.menuAnchor().fillMaxWidth(),
            )
            ExposedDropdownMenu(expanded = typeOpen, onDismissRequest = { typeOpen = false }) {
              // The server only lists the types this employee is eligible for (E8).
              types.forEach { t -> DropdownMenuItem(text = { Text(t.name) }, onClick = { leaveCode = t.code; typeOpen = false; vm.clearFieldError("leaveCode") }) }
            }
          }
          FieldError(errors["leaveCode"])
          if (selected != null) {
            Spacer(Modifier.height(6.dp))
            val b = balances.firstOrNull { it.code == leaveCode }
            Text(availabilityText(selected.requiresBalance, selected.code, b), color = InkFaint, style = MaterialTheme.typography.bodyMedium)
          }

          if (selected?.allowHalfDay == true) {
            Spacer(Modifier.height(14.dp))
            Text("Apply for", color = Ink, fontWeight = FontWeight.SemiBold)
            Row(verticalAlignment = Alignment.CenterVertically) {
              Radio("Full day", duration == "FULL") { duration = "FULL"; session = null; vm.clearFieldError("halfDay") }
              Spacer(Modifier.width(16.dp))
              Radio("Half day", duration == "HALF") { duration = "HALF"; toDate = fromDate }
            }
            if (halfDay) {
              // E12: a half day is one date, first or second half.
              Row(verticalAlignment = Alignment.CenterVertically) {
                Radio("First half", session == "FIRST") { session = "FIRST"; vm.clearFieldError("halfDaySession") }
                Spacer(Modifier.width(16.dp))
                Radio("Second half", session == "SECOND") { session = "SECOND"; vm.clearFieldError("halfDaySession") }
              }
              FieldError(errors["halfDaySession"])
            }
            FieldError(errors["halfDay"])
          }

          if (selected != null) {
            Spacer(Modifier.height(14.dp))
            if (isRh) {
              // E11/E16: RH only on a listed restricted holiday.
              Text("Restricted holiday *", color = Ink, fontWeight = FontWeight.SemiBold)
              Spacer(Modifier.height(6.dp))
              ExposedDropdownMenuBox(expanded = rhOpen, onExpandedChange = { rhOpen = it }) {
                OutlinedTextField(
                  value = rhList.firstOrNull { it.date == fromDate }?.let { "${Dates.dmy(it.date)} · ${it.name}" } ?: "",
                  onValueChange = {}, readOnly = true, placeholder = { Text(if (rhList.isEmpty()) "No restricted holidays listed" else "Pick a date") },
                  trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(rhOpen) }, isError = errors["fromDate"] != null,
                  shape = RoundedCornerShape(12.dp), modifier = Modifier.menuAnchor().fillMaxWidth(),
                )
                ExposedDropdownMenu(expanded = rhOpen, onDismissRequest = { rhOpen = false }) {
                  rhList.forEach { h -> DropdownMenuItem(text = { Text("${Dates.dmy(h.date)} · ${h.name}") }, onClick = { fromDate = h.date; toDate = h.date; rhOpen = false; vm.clearFieldError("fromDate") }) }
                }
              }
              FieldError(errors["fromDate"] ?: errors["toDate"])
            } else if (singleDate) {
              Text("Leave date *", color = Ink, fontWeight = FontWeight.SemiBold)
              Spacer(Modifier.height(6.dp))
              LvDateField("Select date", fromDate, errors["fromDate"] != null, Modifier.fillMaxWidth()) { picker = "SINGLE" }
              FieldError(errors["fromDate"] ?: errors["toDate"])
            } else {
              Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Column(Modifier.weight(1f)) {
                  Text("From date *", color = Ink, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(6.dp))
                  LvDateField("Start date", fromDate, errors["fromDate"] != null, Modifier.fillMaxWidth()) { picker = "FROM" }
                  FieldError(errors["fromDate"])
                }
                Column(Modifier.weight(1f)) {
                  Text("To date *", color = Ink, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(6.dp))
                  LvDateField("End date", toDate, errors["toDate"] != null, Modifier.fillMaxWidth()) { picker = "TO" }
                  FieldError(errors["toDate"])
                }
              }
            }
          }

          // E16: certificate for types that take one (e.g. Sick Leave, Maternity Leave).
          if (selected?.allowCertificate == true) {
            Spacer(Modifier.height(12.dp))
            val after = selected.certificateAfterDays
            Text(
              when {
                after == null -> "A medical certificate is optional for ${selected.name}."
                after <= 0.0 -> "A certificate is required for ${selected.name}."
                else -> "A certificate is required for ${selected.name} of more than ${fmtL(after)} day(s)."
              },
              color = Amber, style = MaterialTheme.typography.bodyMedium,
            )
            Spacer(Modifier.height(8.dp))
            Surface(shape = RoundedCornerShape(12.dp), border = androidx.compose.foundation.BorderStroke(1.dp, if (errors["certificate"] != null) Rose else Line), color = Surface, modifier = Modifier.fillMaxWidth()) {
              Column(Modifier.padding(14.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(certInfo ?: "Upload certificate (PDF or image, max 5MB)", color = if (certificate != null) Green else InkSoft, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                OutlinedButton(onClick = { fileLauncher.launchSafely(ctx, "*/*", "No file picker is available on this phone.") }, shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = Green)) {
                  Icon(Icons.Filled.UploadFile, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)); Text(if (certificate == null) "Add file" else "Replace")
                }
              }
            }
            FieldError(errors["certificate"])
          }

          Spacer(Modifier.height(12.dp))
          OutlinedTextField(reason, { reason = it.take(500); vm.clearFieldError("reason") }, label = { Text("Reason *") }, minLines = 3,
            isError = errors["reason"] != null, supportingText = { Text("${reason.trim().length}/500") },
            shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green), modifier = Modifier.fillMaxWidth())
          FieldError(errors["reason"])
        }
      }

      applyError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      applied?.let { Text(it, color = Green, fontWeight = FontWeight.SemiBold) }
      PrimaryButton(if (submitting) "" else "Submit Leave Request", loading = submitting, enabled = applied == null, onClick = {
        vm.apply(selected, fromDate, toDate, reason, halfDay, session, certificate, certMime, certName)
      }, modifier = Modifier.fillMaxWidth())
      Spacer(Modifier.height(8.dp))
    }
  }
}

/** E13/E14: available after pending; allowance types and LWP described in words. */
internal fun availabilityText(requiresBalance: Boolean, code: String, b: LeaveBalance?): String = when {
  b == null -> ""
  !requiresBalance && code == "LWP" -> "No limit (unpaid)"
  !requiresBalance -> if ((b.available ?: 0.0) <= 0.0) "Not allocated to you (0 days) — ask HR to set a quota"
    else "Allowance left this year: ${fmtL(b.available ?: 0.0)} day(s)"
  else -> "Available: ${fmtL(b.available ?: b.remaining)} day(s)" + if (b.pending > 0) " · ${fmtL(b.pending)} pending" else ""
}

@Composable
private fun Radio(label: String, selected: Boolean, onClick: () -> Unit) {
  Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable(onClick = onClick)) {
    RadioButton(selected = selected, onClick = onClick, colors = RadioButtonDefaults.colors(selectedColor = Green))
    Text(label, color = Ink)
  }
}

@Composable
private fun BalanceChip(b: LeaveBalance, color: Color, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
  Surface(
    color = color.copy(alpha = 0.08f), shape = RoundedCornerShape(12.dp), modifier = modifier.clickable(onClick = onClick),
    border = androidx.compose.foundation.BorderStroke(if (selected) 2.dp else 1.dp, if (selected) color else Line),
  ) {
    Column(Modifier.padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      val v = when {
        !b.requiresBalance && b.code == "LWP" -> "∞"
        else -> fmtL(b.available ?: b.remaining)
      }
      Text(v, color = color, fontWeight = FontWeight.Black, style = MaterialTheme.typography.titleSmall)
      Text(b.code, color = InkFaint, style = MaterialTheme.typography.labelSmall)
    }
  }
}

internal fun fmtL(d: Double): String = if (d == d.toLong().toDouble()) d.toLong().toString() else "%.1f".format(d)

@Composable
private fun LvDateField(hint: String, value: String, isError: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
  OutlinedTextField(
    value = if (value.isBlank()) "" else Dates.dmy(value), onValueChange = {}, readOnly = true, enabled = false,
    placeholder = { Text(hint) },
    trailingIcon = { Icon(Icons.Filled.CalendarMonth, null, tint = InkFaint) },
    shape = RoundedCornerShape(12.dp),
    colors = OutlinedTextFieldDefaults.colors(
      disabledBorderColor = if (isError) Rose else Line, disabledTextColor = Ink, disabledPlaceholderColor = InkFaint, disabledTrailingIconColor = InkFaint,
    ),
    modifier = modifier.clickable(onClick = onClick),
  )
}
