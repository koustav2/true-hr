package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.EditCalendar
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.clickable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*
import java.util.Calendar

private val MONTHS = listOf("January","February","March","April","May","June","July","August","September","October","November","December")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApplyMissPunchScreen(onBack: () -> Unit, vm: MissPunchViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val p by profileVm.state.collectAsState()
  val submitting by vm.submitting.collectAsState()
  val applyError by vm.applyError.collectAsState()
  val applied by vm.applied.collectAsState()

  // Close the screen shortly after a successful submit.
  LaunchedEffect(applied) { if (applied) { kotlinx.coroutines.delay(700); onBack() } }

  val now = remember { Calendar.getInstance() }
  val errors by vm.fieldErrors.collectAsState()
  val ctx = androidx.compose.ui.platform.LocalContext.current
  var days by rememberSaveable { mutableStateOf("") }
  var monthIdx by rememberSaveable { mutableStateOf(now.get(Calendar.MONTH)) }
  val thisYear = now.get(Calendar.YEAR)
  var year by rememberSaveable { mutableStateOf(thisYear) }
  var inTime by rememberSaveable { mutableStateOf("") }
  var outTime by rememberSaveable { mutableStateOf("") }
  var remarks by rememberSaveable { mutableStateOf("") }
  var monthOpen by remember { mutableStateOf(false) }
  var yearOpen by remember { mutableStateOf(false) }

  fun pickTime(current: String, onSet: (String) -> Unit) {
    val h = current.take(2).toIntOrNull() ?: 9
    val m = current.drop(3).take(2).toIntOrNull() ?: 30
    android.app.TimePickerDialog(ctx, { _, hh, mm -> onSet("%02d:%02d".format(hh, mm)) }, h, m, false).show()
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Apply Miss Punch", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      InfoCard {
        CardHeader(Icons.Filled.Badge, "Employee Details")
        InfoRow("Employee Code", p.data?.employeeCode)
        InfoRow("Name", p.data?.fullName)
        InfoRow("Designation", p.data?.designation)
        InfoRow("Department", p.data?.department)
        InfoRow("Location", p.data?.location)
      }
      InfoCard {
        CardHeader(Icons.Filled.EditCalendar, "Application Details")
        AppTextField(days, { days = it.filter { c -> c.isDigit() || c == ',' || c == ' ' }; vm.clearFieldError("days") }, "Day(s) of month * (e.g. 3 or 3,5)",
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        FieldError(errors["days"])
        Text("Only past days you missed a punch on. Each day once.", color = InkFaint, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          ExposedDropdownMenuBox(expanded = monthOpen, onExpandedChange = { monthOpen = it }, modifier = Modifier.weight(1f)) {
            OutlinedTextField(
              value = MONTHS[monthIdx], onValueChange = {}, readOnly = true, label = { Text("Month *") },
              trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(monthOpen) },
              shape = RoundedCornerShape(12.dp),
              colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
              modifier = Modifier.menuAnchor().fillMaxWidth(),
            )
            ExposedDropdownMenu(expanded = monthOpen, onDismissRequest = { monthOpen = false }) {
              MONTHS.forEachIndexed { i, m -> DropdownMenuItem(text = { Text(m) }, onClick = { monthIdx = i; monthOpen = false; vm.clearFieldError("days") }) }
            }
          }
          // E7: the year is a choice, not free text.
          ExposedDropdownMenuBox(expanded = yearOpen, onExpandedChange = { yearOpen = it }, modifier = Modifier.weight(1f)) {
            OutlinedTextField(
              value = year.toString(), onValueChange = {}, readOnly = true, label = { Text("Year *") },
              trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(yearOpen) },
              shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
              modifier = Modifier.menuAnchor().fillMaxWidth(),
            )
            ExposedDropdownMenu(expanded = yearOpen, onDismissRequest = { yearOpen = false }) {
              listOf(thisYear, thisYear - 1).forEach { y -> DropdownMenuItem(text = { Text(y.toString()) }, onClick = { year = y; yearOpen = false; vm.clearFieldError("days") }) }
            }
          }
        }
        FieldError(errors["month"] ?: errors["year"])
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          Column(Modifier.weight(1f)) {
            TimeBox("In time *", inTime, errors["inTime"] != null) { pickTime(inTime) { inTime = it; vm.clearFieldError("inTime") } }
            FieldError(errors["inTime"])
          }
          Column(Modifier.weight(1f)) {
            TimeBox("Out time *", outTime, errors["outTime"] != null) { pickTime(outTime.ifBlank { "18:30" }) { outTime = it; vm.clearFieldError("outTime") } }
            FieldError(errors["outTime"])
          }
        }
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(remarks, { remarks = it.take(500); vm.clearFieldError("remarks") }, label = { Text("Remarks *") }, minLines = 3,
          isError = errors["remarks"] != null,
          shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
          modifier = Modifier.fillMaxWidth())
        FieldError(errors["remarks"])
      }
      applyError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      if (applied) Text("Your miss-punch request has been submitted.", color = Green, fontWeight = FontWeight.SemiBold)
      PrimaryButton(if (submitting) "" else "Submit", loading = submitting, enabled = !applied, onClick = {
        vm.apply(days, monthIdx + 1, year, inTime, outTime, remarks)
      }, modifier = Modifier.fillMaxWidth())
      Spacer(Modifier.height(8.dp))
    }
  }
}

@Composable
private fun TimeBox(label: String, value: String, isError: Boolean, onClick: () -> Unit) {
  OutlinedTextField(
    value = value, onValueChange = {}, readOnly = true, enabled = false, label = { Text(label) },
    placeholder = { Text("HH:MM") },
    shape = RoundedCornerShape(12.dp),
    colors = OutlinedTextFieldDefaults.colors(disabledBorderColor = if (isError) Rose else Line, disabledTextColor = Ink, disabledLabelColor = InkSoft),
    modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
  )
}

@Composable
private fun CardHeader(icon: ImageVector, title: String) {
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
