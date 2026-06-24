package com.truehr.app.presentation.feature

import android.app.DatePickerDialog
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.Resignation
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

private val ISO = SimpleDateFormat("yyyy-MM-dd", Locale.US)
private val SHOW = SimpleDateFormat("dd/MM/yyyy", Locale.getDefault())

@Composable
fun ResignationScreen(onBack: () -> Unit, vm: ResignationViewModel = hiltViewModel()) {
  val context = LocalContext.current
  val s by vm.context.collectAsState()
  val submitting by vm.submitting.collectAsState()
  val message by vm.message.collectAsState()

  LaunchedEffect(Unit) { vm.loadContext() }
  LaunchedEffect(message) { message?.let { Toast.makeText(context, it, Toast.LENGTH_SHORT).show(); vm.consumeMessage() } }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Resignation", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.loadContext() })
      s.data != null -> Body(s.data!!, submitting, vm)
    }
  }
}

@Composable
private fun Body(ctx: com.truehr.app.domain.model.ResignationContext, submitting: Boolean, vm: ResignationViewModel) {
  val context = LocalContext.current
  val emp = ctx.employee
  val current = ctx.current

  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
    // Employee details
    Section("Employee Details") {
      KV("Employee Code", emp?.employeeCode)
      KV("Full Name", emp?.name)
      KV("Vertical", emp?.vertical)
      KV("Office Location", emp?.location)
      KV("Designation", emp?.designation)
      KV("Notice Period", emp?.noticePeriodDays?.let { "$it Days" })
    }

    if (current != null) {
      // Already submitted — show status instead of the form
      CurrentStatus(current, submitting) { vm.withdraw(current.id) }
    } else {
      ResignForm(emp?.noticePeriodDays ?: 30, submitting, context) { rd, lwd, reason -> vm.apply(rd, lwd, reason) }
    }

    // Approvals
    if (ctx.approvers.isNotEmpty()) {
      Section("Approvals") {
        ctx.approvers.forEach { a ->
          Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
            Text(listOfNotNull(a.employeeCode, a.name).joinToString(" - ").ifBlank { "—" }, fontWeight = FontWeight.SemiBold, color = Ink, style = MaterialTheme.typography.bodyMedium)
            Text(a.email ?: "—", color = InkSoft, style = MaterialTheme.typography.bodySmall)
          }
          HorizontalDivider(color = Line)
        }
      }
    }
  }
}

@Composable
private fun ResignForm(noticeDays: Int, submitting: Boolean, context: android.content.Context, onSubmit: (String, String, String) -> Unit) {
  val resignCal = remember { Calendar.getInstance() }
  val lwdCal = remember { Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, noticeDays) } }
  var resignText by remember { mutableStateOf(SHOW.format(resignCal.time)) }
  var lwdText by remember { mutableStateOf(SHOW.format(lwdCal.time)) }
  var reason by remember { mutableStateOf("") }

  fun pick(cal: Calendar, onSet: () -> Unit) {
    DatePickerDialog(context, { _, y, m, d -> cal.set(y, m, d); onSet() },
      cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
  }

  Section("Submit Resignation") {
    DateField("Resignation Date", resignText) { pick(resignCal) { resignText = SHOW.format(resignCal.time) } }
    Spacer(Modifier.height(12.dp))
    DateField("Last Working Date", lwdText) { pick(lwdCal) { lwdText = SHOW.format(lwdCal.time) } }
    Spacer(Modifier.height(12.dp))
    Text("Reason *", color = InkSoft, style = MaterialTheme.typography.labelMedium)
    Spacer(Modifier.height(4.dp))
    OutlinedTextField(
      value = reason, onValueChange = { reason = it }, minLines = 3,
      placeholder = { Text("Reason for leaving…") }, shape = RoundedCornerShape(12.dp),
      colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green, focusedLabelColor = Green, cursorColor = Green),
      modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(16.dp))
    Button(
      onClick = { if (reason.isNotBlank()) onSubmit(ISO.format(resignCal.time), ISO.format(lwdCal.time), reason) },
      enabled = !submitting && reason.isNotBlank(),
      shape = RoundedCornerShape(12.dp),
      colors = ButtonDefaults.buttonColors(containerColor = Pink, contentColor = Surface),
      modifier = Modifier.fillMaxWidth().height(50.dp),
    ) {
      if (submitting) CircularProgressIndicator(color = Surface, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
      else Text("Submit", fontWeight = FontWeight.Bold)
    }
  }
}

@Composable
private fun CurrentStatus(r: Resignation, submitting: Boolean, onWithdraw: () -> Unit) {
  val color = when (r.status) { "APPROVED" -> Green; "REJECTED" -> Rose; else -> Amber }
  Section("Your Resignation") {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text("Status", color = InkFaint, modifier = Modifier.weight(1f))
      Surface(color = color.copy(alpha = 0.14f), shape = RoundedCornerShape(20.dp)) {
        Text(r.status?.lowercase()?.replaceFirstChar { it.uppercase() } ?: "—", color = color, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp))
      }
    }
    Spacer(Modifier.height(8.dp))
    KV("Resignation Date", r.resignationDate?.let { dmy(it) })
    KV("Last Working Date", r.lastWorkingDate?.let { dmy(it) })
    KV("Reason", r.reason)
    if (!r.reviewNote.isNullOrBlank()) KV("Reviewer remark", r.reviewNote)
    if (r.status == "PENDING") {
      Spacer(Modifier.height(12.dp))
      OutlinedButton(onClick = onWithdraw, enabled = !submitting, modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = Rose)) {
        Text("Withdraw resignation", fontWeight = FontWeight.SemiBold)
      }
    }
  }
}

@Composable
private fun Section(title: String, content: @Composable ColumnScope.() -> Unit) {
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
    Column {
      Box(Modifier.fillMaxWidth().background(Teal).padding(horizontal = 16.dp, vertical = 12.dp)) {
        Text(title, color = Surface, fontWeight = FontWeight.Bold)
      }
      Column(Modifier.padding(16.dp), content = content)
    }
  }
}

@Composable
private fun DateField(label: String, value: String, onClick: () -> Unit) {
  Text("$label *", color = InkSoft, style = MaterialTheme.typography.labelMedium)
  Spacer(Modifier.height(4.dp))
  Surface(color = Surface, shape = RoundedCornerShape(12.dp),
    border = androidx.compose.foundation.BorderStroke(1.dp, Line),
    modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(Icons.Filled.CalendarMonth, null, tint = Teal, modifier = Modifier.size(18.dp))
      Spacer(Modifier.width(10.dp))
      Text(value, color = Ink)
    }
  }
}

@Composable
private fun KV(k: String, v: String?) {
  Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
    Text(k, color = InkFaint, modifier = Modifier.width(140.dp), style = MaterialTheme.typography.bodyMedium)
    Text(v?.takeIf { it.isNotBlank() } ?: "—", color = Ink, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
  }
}

private fun dmy(iso: String): String {
  val p = iso.take(10).split("-")
  return if (p.size == 3) "${p[2]}/${p[1]}/${p[0]}" else iso
}
