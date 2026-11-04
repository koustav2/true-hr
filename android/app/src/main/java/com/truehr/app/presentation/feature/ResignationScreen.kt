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
import com.truehr.app.core.launchSafely
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
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
  LaunchedEffect(message) { message?.let { Toast.makeText(context, it, Toast.LENGTH_LONG).show(); vm.consumeMessage() } }

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
    // E49: filled from the employee master.
    Section("Employee Details") {
      KV("Employee Code", emp?.employeeCode)
      KV("Full Name", emp?.name)
      KV("Vertical", emp?.vertical)
      KV("Department", emp?.department)
      KV("Designation", emp?.designation)
      KV("Office Location", emp?.location)
      KV("Date of Joining", emp?.dateOfJoining?.let { com.truehr.app.core.Dates.dmy(it) })
      KV("Reporting Manager", emp?.reportingManager)
      KV("Notice Period", emp?.noticePeriodDays?.let { "$it Days" })
    }

    if (current != null) {
      // Already submitted — show status instead of the form
      CurrentStatus(current, submitting) { vm.withdraw(current.id) }
    } else if (!ctx.canSubmit) {
      // E50: a required approval stage has nobody assigned.
      Section("Submit Resignation") {
        Text(
          "Your resignation cannot be submitted yet: no ${ctx.missingStages.joinToString(", ")} approver is set up for you. Please ask HR to assign one.",
          color = Rose, style = MaterialTheme.typography.bodyMedium,
        )
      }
    } else {
      ResignForm(ctx, vm, submitting)
    }

    // Approvals — GreenHR-style stage table: role → approver → status
    if (ctx.approvers.isNotEmpty()) {
      Section("Approvals") {
        ctx.approvers.forEachIndexed { i, a ->
          Row(
            Modifier.fillMaxWidth().padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(
              a.stage ?: "Approver",
              modifier = Modifier.width(126.dp),
              fontWeight = FontWeight.SemiBold, color = InkSoft,
              style = MaterialTheme.typography.bodySmall,
            )
            Column(Modifier.weight(1f)) {
              Text(
                listOfNotNull(a.employeeCode, a.name).joinToString(" - ")
                  .ifBlank { if (a.assignment == "SKIPPED") "Not assigned — will be skipped" else "Not assigned (required)" },
                fontWeight = FontWeight.SemiBold, color = if (a.name != null) Ink else InkFaint,
                style = MaterialTheme.typography.bodyMedium,
              )
              a.email?.let { Text(it, color = InkSoft, style = MaterialTheme.typography.bodySmall) }
            }
            a.status?.let { st ->
              val (bg, fg) = when (st) {
                "APPROVED" -> Color(0xFFDCFCE7) to Color(0xFF15803D)
                "REJECTED" -> Color(0xFFFEE2E2) to Color(0xFFB91C1C)
                "BYPASSED" -> Color(0xFFF1F5F9) to Color(0xFF64748B)
                "PENDING" -> Color(0xFFFEF3C7) to Color(0xFFB45309)
                else -> Color(0xFFF1F5F9) to Color(0xFF64748B)
              }
              Text(
                com.truehr.app.core.Labels.of(st),
                color = fg,
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier
                  .clip(RoundedCornerShape(999.dp))
                  .background(bg)
                  .padding(horizontal = 10.dp, vertical = 4.dp),
              )
            }
          }
          if (i != ctx.approvers.lastIndex) HorizontalDivider(color = Line)
        }
      }
    }
  }
}

@Composable
private fun ResignForm(ctx: com.truehr.app.domain.model.ResignationContext, vm: ResignationViewModel, submitting: Boolean) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val errors by vm.fieldErrors.collectAsState()
  val today = ctx.today ?: com.truehr.app.core.Dates.todayIso()
  val np = ctx.employee?.noticePeriodDays ?: 30
  // E51: resignation date defaults to today; LWD to today + notice period.
  var resignDate by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(today) }
  var lwd by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(ctx.suggestedLastWorkingDate ?: com.truehr.app.core.Dates.addDays(today, np)) }
  var reason by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf("") }
  var letter by remember { mutableStateOf<com.truehr.app.core.PickedFile?>(null) }
  var letterInfo by remember { mutableStateOf<String?>(null) }
  var confirmOpen by remember { mutableStateOf(false) }

  val picker = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetContent()) { uri ->
    if (uri != null) scope.launch {
      com.truehr.app.core.readPickedFile(context, uri).onSuccess { letter = it; letterInfo = "${it.name} (${it.sizeKb} KB)" }.onFailure { letterInfo = it.message }
    }
  }

  if (confirmOpen) {
    AlertDialog(
      onDismissRequest = { confirmOpen = false },
      title = { Text("Submit your resignation?") },
      text = {
        Text(
          "Your resignation will go to your approvers. You keep full access to the app during your notice period, " +
            "and you can withdraw it until it is finally approved. Access ends automatically after your approved last working day.",
        )
      },
      confirmButton = {
        TextButton(onClick = { confirmOpen = false; vm.apply(resignDate, lwd, reason, letter) }) { Text("Submit", color = Rose) }
      },
      dismissButton = { TextButton(onClick = { confirmOpen = false }) { Text("Cancel") } },
    )
  }

  fun pick(current: String, min: String?, max: String?, onSet: (String) -> Unit) {
    val p = current.split("-").map { it.toInt() }
    DatePickerDialog(context, { _, y, m, d -> onSet(com.truehr.app.core.Dates.iso(y, m + 1, d)) }, p[0], p[1] - 1, p[2]).apply {
      min?.let { com.truehr.app.core.Dates.toPickerMillis(it) }?.let { datePicker.minDate = it }
      max?.let { com.truehr.app.core.Dates.toPickerMillis(it) }?.let { datePicker.maxDate = it }
    }.show()
  }

  Section("Submit Resignation") {
    DateField("Resignation Date", com.truehr.app.core.Dates.dmy(resignDate), errors["resignationDate"] != null) {
      pick(resignDate, ctx.minResignationDate, ctx.maxResignationDate) { resignDate = it; vm.clearFieldError("resignationDate") }
    }
    com.truehr.app.presentation.components.FieldError(errors["resignationDate"])
    Spacer(Modifier.height(12.dp))
    DateField("Last Working Date", com.truehr.app.core.Dates.dmy(lwd), errors["lastWorkingDate"] != null) {
      pick(lwd, resignDate, null) { lwd = it; vm.clearFieldError("lastWorkingDate") }
    }
    com.truehr.app.presentation.components.FieldError(errors["lastWorkingDate"])
    Text("Notice period: $np days", color = InkFaint, style = MaterialTheme.typography.bodySmall)
    Spacer(Modifier.height(12.dp))
    Text("Reason *", color = InkSoft, style = MaterialTheme.typography.labelMedium)
    Spacer(Modifier.height(4.dp))
    OutlinedTextField(
      value = reason, onValueChange = { reason = it.take(1000); vm.clearFieldError("reason") }, minLines = 3, isError = errors["reason"] != null,
      placeholder = { Text("Reason for leaving…") }, shape = RoundedCornerShape(12.dp),
      colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green, focusedLabelColor = Green, cursorColor = Green),
      modifier = Modifier.fillMaxWidth(),
    )
    com.truehr.app.presentation.components.FieldError(errors["reason"])
    Spacer(Modifier.height(10.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(letterInfo ?: "Resignation letter (optional, PDF/image, max 5MB)", color = if (letter != null) Green else InkSoft,
        style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
      TextButton(onClick = { picker.launchSafely(context, "*/*", "No file picker is available on this phone.") }) { Text(if (letter == null) "Attach" else "Replace", color = Green) }
    }
    com.truehr.app.presentation.components.FieldError(errors["letter"])
    Spacer(Modifier.height(10.dp))
    Button(
      onClick = { if (vm.validate(resignDate, lwd, reason)) confirmOpen = true },
      enabled = !submitting,
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
  var confirmWithdraw by remember { mutableStateOf(false) }
  if (confirmWithdraw) com.truehr.app.presentation.components.ConfirmDialog(
    "Withdraw your resignation?", "Your resignation will be cancelled and your approvers informed.", "Withdraw",
    onConfirm = { confirmWithdraw = false; onWithdraw() }, onDismiss = { confirmWithdraw = false }, dismissLabel = "Keep it")
  Section("Your Resignation") {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text("Status", color = InkFaint, modifier = Modifier.weight(1f))
      Surface(color = color.copy(alpha = 0.14f), shape = RoundedCornerShape(20.dp)) {
        Text(com.truehr.app.core.Labels.of(r.status), color = color, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp))
      }
    }
    Spacer(Modifier.height(8.dp))
    KV("Resignation Date", r.resignationDate?.let { dmy(it) })
    KV("Last Working Date", r.lastWorkingDate?.let { dmy(it) })
    KV("Reason", r.reason)
    if (!r.reviewNote.isNullOrBlank()) KV("Reviewer remark", r.reviewNote)
    if (r.status == "PENDING") {
      Spacer(Modifier.height(12.dp))
      OutlinedButton(onClick = { confirmWithdraw = true }, enabled = !submitting, modifier = Modifier.fillMaxWidth(),
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
private fun DateField(label: String, value: String, isError: Boolean = false, onClick: () -> Unit) {
  Text("$label *", color = InkSoft, style = MaterialTheme.typography.labelMedium)
  Spacer(Modifier.height(4.dp))
  Surface(color = Surface, shape = RoundedCornerShape(12.dp),
    border = androidx.compose.foundation.BorderStroke(1.dp, if (isError) Rose else Line),
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

private fun dmy(iso: String): String = com.truehr.app.core.Dates.dmy(iso)
