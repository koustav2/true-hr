package com.truehr.app.presentation.profile

import android.app.DatePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.core.Dates
import com.truehr.app.core.Labels
import com.truehr.app.core.Validators
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.theme.*

private val CR_TABS = listOf("PROFILE" to "Personal details", "ADDRESS" to "Address", "BANK" to "Bank account")
private val KIND_NOUN = mapOf("PROFILE" to "a personal details", "ADDRESS" to "an address", "BANK" to "a bank account")

/**
 * E57-E61 "Request a change" — same v2 endpoints and rules as web ESS:
 * pre-filled from the record, only changed fields sent, every error at once,
 * a pending request can be edited or withdrawn, all requests listed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChangeRequestScreen(onBack: () -> Unit, vm: ChangeRequestViewModel = hiltViewModel()) {
  val ctx = LocalContext.current
  val prof by vm.profile.collectAsState()
  val history by vm.history.collectAsState()
  val busy by vm.busy.collectAsState()
  val errors by vm.fieldErrors.collectAsState()
  val message by vm.message.collectAsState()
  val success by vm.success.collectAsState()

  var tab by remember { mutableStateOf(0) }
  var addressType by remember { mutableStateOf("CURRENT") }
  var editing by remember { mutableStateOf<ChangeRequestItem?>(null) }
  var confirmWithdraw by remember { mutableStateOf<ChangeRequestItem?>(null) }
  val kind = CR_TABS[tab].first
  val me = prof.data
  val base = remember(me, kind, addressType) { me?.let { ChangeRequestForm.base(kind, it, addressType) } ?: emptyMap() }
  val form = remember(base, editing) { mutableStateMapOf<String, String>().apply { putAll(base); editing?.payload?.forEach { (k, v) -> if (k != "type") put(k, v) } } }
  val pending = history.firstOrNull { it.status == "PENDING" && it.kind == kind }

  confirmWithdraw?.let { r ->
    ConfirmDialog("Withdraw this request?", "HR will no longer see it. You can raise a new one afterwards.", "Withdraw",
      onConfirm = { vm.withdraw(r.id); confirmWithdraw = null; editing = null }, onDismiss = { confirmWithdraw = null })
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Request a change", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    when {
      prof.loading -> CenterLoader()
      prof.error != null -> ErrorState(prof.error!!, onRetry = { vm.load() })
      me != null -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("You cannot edit your record directly. Propose the change here and HR will review it.", color = InkSoft, style = MaterialTheme.typography.bodyMedium)
        ScrollableTabRow(selectedTabIndex = tab, containerColor = Surface, contentColor = Green, edgePadding = 0.dp) {
          CR_TABS.forEachIndexed { i, (_, l) -> Tab(selected = tab == i, onClick = { tab = i; editing = null; vm.clearFieldError("_") }, text = { Text(l) }) }
        }

        if (pending != null && editing == null) {
          InfoCard {
            Text("You already have ${KIND_NOUN[kind]} request pending with HR.", color = Ink, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
              OutlinedButton(onClick = { editing = pending; if (pending.payload["type"] != null) addressType = pending.payload["type"]!! }, enabled = !busy) { Text("Edit") }
              OutlinedButton(onClick = { confirmWithdraw = pending }, enabled = !busy, colors = ButtonDefaults.outlinedButtonColors(contentColor = Rose)) { Text("Withdraw") }
            }
          }
        } else {
          InfoCard {
            if (editing != null) Text("Editing your pending request", color = Amber, fontWeight = FontWeight.SemiBold)
            if (kind == "ADDRESS") {
              Row(verticalAlignment = Alignment.CenterVertically) {
                listOf("CURRENT", "PERMANENT").forEach { t ->
                  Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable(enabled = editing == null) { addressType = t }) {
                    RadioButton(selected = addressType == t, onClick = { if (editing == null) addressType = t })
                    Text(Labels.of(t), color = Ink)
                  }
                  Spacer(Modifier.width(8.dp))
                }
              }
            }
            ChangeRequestForm.FIELDS[kind]!!.forEach { key ->
              val label = ChangeRequestForm.LABEL[key] ?: key
              val value = form[key].orEmpty()
              when (key) {
                "gender" -> Picker(label, if (value.isBlank()) "" else Labels.of(value), listOf("MALE", "FEMALE", "OTHER"), { Labels.of(it) }, errors[key]) { form[key] = it; vm.clearFieldError(key) }
                "state" -> Picker(label, value, Validators.INDIAN_STATES, { it }, errors[key]) { form[key] = it; vm.clearFieldError(key) }
                "dob" -> {
                  OutlinedTextField(if (value.isBlank()) "" else Dates.dmy(value), {}, readOnly = true, enabled = false, label = { Text(label) },
                    colors = OutlinedTextFieldDefaults.colors(disabledBorderColor = if (errors[key] != null) Rose else Line, disabledTextColor = Ink, disabledLabelColor = InkSoft),
                    modifier = Modifier.fillMaxWidth().clickable {
                      val p = (value.ifBlank { Dates.addYears(Dates.todayIso(), -25) }).split("-").map { it.toInt() }
                      DatePickerDialog(ctx, { _, y, m, d -> form[key] = Dates.iso(y, m + 1, d); vm.clearFieldError(key) }, p[0], p[1] - 1, p[2])
                        .apply { Dates.toPickerMillis(Dates.addYears(Dates.todayIso(), -18))?.let { datePicker.maxDate = it } }.show()
                    })
                  FieldError(errors[key])
                }
                else -> {
                  val kb = when (key) { "phone" -> KeyboardType.Phone; "pincode", "accountNumber" -> KeyboardType.Number; "personalEmail" -> KeyboardType.Email; else -> KeyboardType.Text }
                  AppTextField(value, { form[key] = it; vm.clearFieldError(key) }, if (key == "accountNumber") "$label (leave blank to keep)" else label,
                    keyboardOptions = KeyboardOptions(keyboardType = kb))
                  FieldError(errors[key])
                }
              }
              Spacer(Modifier.height(8.dp))
            }
            message?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
              PrimaryButton(if (busy) "" else if (editing != null) "Update request" else "Send to HR", loading = busy,
                onClick = { vm.submit(kind, form.toMap(), base, addressType, editing?.id) }, modifier = Modifier.weight(1f))
              if (editing != null) OutlinedButton(onClick = { editing = null }, modifier = Modifier.height(52.dp)) { Text("Cancel") }
            }
          }
        }
        success?.let { Text(it, color = Green, fontWeight = FontWeight.SemiBold) }

        SectionTitle("My requests")
        if (history.isEmpty()) Text("No requests yet.", color = InkSoft)
        history.forEach { r ->
          InfoCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
              Text(Labels.of(r.kind), fontWeight = FontWeight.Bold, color = Ink, modifier = Modifier.weight(1f))
              StatusChip(r.status)
            }
            Text("Sent ${Dates.dmy(r.submittedAt)}", color = InkFaint, style = MaterialTheme.typography.labelSmall)
            r.payload.forEach { (k, v) -> Text("${ChangeRequestForm.LABEL[k] ?: k}: ${ChangeRequestForm.show(k, v)}", color = InkSoft, style = MaterialTheme.typography.bodySmall) }
            r.reviewNote?.takeIf { it.isNotBlank() }?.let { Text("HR note: $it", color = InkSoft, style = MaterialTheme.typography.bodySmall) }
            if (r.status == "PENDING") Row {
              TextButton(onClick = { tab = CR_TABS.indexOfFirst { it.first == r.kind }.coerceAtLeast(0); editing = r; r.payload["type"]?.let { addressType = it } }) { Text("Edit") }
              TextButton(onClick = { confirmWithdraw = r }) { Text("Withdraw", color = Rose) }
            }
          }
        }
        Spacer(Modifier.height(16.dp))
      }
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> Picker(label: String, shown: String, options: List<T>, text: (T) -> String, error: String?, onPick: (T) -> Unit) {
  var open by remember { mutableStateOf(false) }
  ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
    OutlinedTextField(shown, {}, readOnly = true, label = { Text(label) }, isError = error != null,
      trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) }, modifier = Modifier.menuAnchor().fillMaxWidth())
    ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      options.forEach { o -> DropdownMenuItem(text = { Text(text(o)) }, onClick = { onPick(o); open = false }) }
    }
  }
  FieldError(error)
}
