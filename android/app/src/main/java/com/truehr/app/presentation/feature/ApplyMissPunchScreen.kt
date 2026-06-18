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
  var days by remember { mutableStateOf("") }
  var monthIdx by remember { mutableStateOf(now.get(Calendar.MONTH)) }
  var year by remember { mutableStateOf(now.get(Calendar.YEAR).toString()) }
  var remarks by remember { mutableStateOf("") }
  var monthOpen by remember { mutableStateOf(false) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Apply Miss Punch", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      // Employee details
      InfoCard {
        CardHeader(Icons.Filled.Badge, "Employee Details")
        InfoRow("Employee Code", p.data?.employeeCode)
        InfoRow("Name", p.data?.fullName)
        InfoRow("Designation", p.data?.designation)
        InfoRow("Vertical", p.data?.department)
        InfoRow("Location", p.data?.location)
      }
      // Application details
      InfoCard {
        CardHeader(Icons.Filled.EditCalendar, "Application Details")
        AppTextField(days, { days = it }, "Day(s) of month (e.g., 1,5,10)")
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          ExposedDropdownMenuBox(expanded = monthOpen, onExpandedChange = { monthOpen = it }, modifier = Modifier.weight(1f)) {
            OutlinedTextField(
              value = MONTHS[monthIdx], onValueChange = {}, readOnly = true, label = { Text("Month") },
              trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(monthOpen) },
              shape = RoundedCornerShape(12.dp),
              colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
              modifier = Modifier.menuAnchor().fillMaxWidth(),
            )
            ExposedDropdownMenu(expanded = monthOpen, onDismissRequest = { monthOpen = false }) {
              MONTHS.forEachIndexed { i, m -> DropdownMenuItem(text = { Text(m) }, onClick = { monthIdx = i; monthOpen = false }) }
            }
          }
          AppTextField(year, { year = it.filter { c -> c.isDigit() }.take(4) }, "Year", modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(remarks, { remarks = it }, label = { Text("Remarks") }, minLines = 3,
          shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
          modifier = Modifier.fillMaxWidth())
      }
      applyError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      if (applied) Text("Your miss-punch request has been submitted.", color = Green, fontWeight = FontWeight.SemiBold)
      PrimaryButton(if (submitting) "" else "Submit", loading = submitting, onClick = {
        vm.apply(days.trim(), monthIdx + 1, year.toIntOrNull() ?: now.get(Calendar.YEAR), remarks)
      }, modifier = Modifier.fillMaxWidth())
      Spacer(Modifier.height(8.dp))
    }
  }
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
