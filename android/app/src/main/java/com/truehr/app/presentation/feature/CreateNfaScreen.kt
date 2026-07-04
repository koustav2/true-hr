package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.PostAdd
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.*
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.theme.*
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

private val MONTH_NAMES = listOf("January","February","March","April","May","June","July","August","September","October","November","December")
private val PAYMENT_TYPES = listOf(
  "ADVANCE_SELF" to "Advance for self", "ADVANCE_VENDOR" to "Advance for Vendor",
  "REIMB_SELF" to "Reimbursement for self", "REIMB_VENDOR" to "Reimbursement for Vendor",
  "PPS_CANDIDATE" to "PPS for Candidate", "INCENTIVE" to "Incentive Payment",
)
private val BILLABLE_TYPES = listOf(
  "NON_BILLABLE" to "Non-billable from client", "BILLABLE_CLIENT" to "Billable from client", "BILLABLE_PARTNER" to "Billable from Partner",
)
private val PRIORITIES = listOf("HIGH", "MEDIUM", "LOW")

// Master pickers: small lists use a dropdown; large masters (locations, clients,
// sub-headers…) open a searchable full-screen dialog — GreenHR's endless scroll
// through hundreds of vendors was a key pain point to fix.
@Composable
internal fun <T> PickerField(
  label: String, options: List<T>, selected: T?, display: (T) -> String, onSelect: (T) -> Unit,
  modifier: Modifier = Modifier, enabled: Boolean = true,
) {
  var open by remember { mutableStateOf(false) }
  val searchable = options.size > 12

  if (searchable) {
    OutlinedTextField(
      value = selected?.let(display) ?: "", onValueChange = {}, readOnly = true, enabled = false,
      label = { Text(label) },
      trailingIcon = { Icon(Icons.Filled.Search, null, tint = InkFaint) },
      shape = RoundedCornerShape(12.dp),
      colors = OutlinedTextFieldDefaults.colors(
        disabledBorderColor = Line, disabledTextColor = Ink, disabledLabelColor = InkFaint, disabledTrailingIconColor = InkFaint,
      ),
      modifier = modifier.fillMaxWidth().clickable(enabled = enabled) { open = true },
    )
    if (open) SearchPickerDialog(label, options, display, onDismiss = { open = false }) { onSelect(it); open = false }
  } else {
    @OptIn(ExperimentalMaterial3Api::class)
    ExposedDropdownMenuBox(expanded = open && enabled, onExpandedChange = { if (enabled) open = it }, modifier = modifier) {
      OutlinedTextField(
        value = selected?.let(display) ?: "", onValueChange = {}, readOnly = true, enabled = enabled,
        label = { Text(label) },
        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
        modifier = Modifier.menuAnchor().fillMaxWidth(),
      )
      ExposedDropdownMenu(expanded = open && enabled, onDismissRequest = { open = false }) {
        options.forEach { o -> DropdownMenuItem(text = { Text(display(o)) }, onClick = { onSelect(o); open = false }) }
      }
    }
  }
}

@Composable
internal fun <T> SearchPickerDialog(
  title: String, options: List<T>, display: (T) -> String, onDismiss: () -> Unit, onSelect: (T) -> Unit,
) {
  var q by remember { mutableStateOf("") }
  val filtered = remember(q, options) {
    if (q.isBlank()) options else options.filter { display(it).contains(q, ignoreCase = true) }
  }
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text(title) },
    text = {
      Column {
        OutlinedTextField(
          value = q, onValueChange = { q = it }, placeholder = { Text("Search…") }, singleLine = true,
          shape = RoundedCornerShape(12.dp),
          colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
          modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        LazyColumn(Modifier.heightIn(max = 380.dp)) {
          items(filtered.size) { i ->
            val o = filtered[i]
            Text(
              display(o),
              color = Ink,
              style = MaterialTheme.typography.bodyMedium,
              modifier = Modifier.fillMaxWidth()
                .clickable { onSelect(o) }
                .padding(vertical = 10.dp, horizontal = 4.dp),
            )
            HorizontalDivider(color = Line)
          }
          if (filtered.isEmpty()) item { Text("No matches", color = InkFaint, modifier = Modifier.padding(12.dp)) }
        }
      }
    },
    confirmButton = {},
    dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
  )
}

// Read-only date field that opens a Material date picker (same pattern as Apply Leave).
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun DatePickField(label: String, value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier) {
  var open by remember { mutableStateOf(false) }
  OutlinedTextField(
    value = value, onValueChange = {}, readOnly = true, enabled = false,
    label = { Text(label) },
    trailingIcon = { Icon(Icons.Filled.CalendarMonth, null, tint = InkFaint) },
    shape = RoundedCornerShape(12.dp),
    colors = OutlinedTextFieldDefaults.colors(
      disabledBorderColor = Line, disabledTextColor = Ink, disabledLabelColor = InkFaint, disabledTrailingIconColor = InkFaint,
    ),
    modifier = modifier.fillMaxWidth().clickable { open = true },
  )
  if (open) {
    val state = rememberDatePickerState()
    DatePickerDialog(
      onDismissRequest = { open = false },
      confirmButton = {
        TextButton(onClick = {
          state.selectedDateMillis?.let { ms ->
            onValueChange(SimpleDateFormat("yyyy-MM-dd", Locale.US).format(java.util.Date(ms)))
          }
          open = false
        }) { Text("OK") }
      },
      dismissButton = { TextButton(onClick = { open = false }) { Text("Cancel") } },
    ) { DatePicker(state = state) }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateNfaScreen(onBack: () -> Unit, vm: NfaViewModel = hiltViewModel()) {
  val masters by vm.masters.collectAsState()
  val preview by vm.preview.collectAsState()
  val submitting by vm.submitting.collectAsState()
  val createError by vm.createError.collectAsState()
  val created by vm.created.collectAsState()
  LaunchedEffect(Unit) { vm.loadMasters() }
  LaunchedEffect(created) { if (created) { kotlinx.coroutines.delay(700); onBack() } }

  var raiseFor by remember { mutableStateOf("EXPENSE") }
  var operation by remember { mutableStateOf<NfaOption?>(null) }
  var company by remember { mutableStateOf<NfaOption?>(null) }
  var project by remember { mutableStateOf<NfaProject?>(null) }
  var category by remember { mutableStateOf<NfaExpenseCategory?>(null) }
  var zone by remember { mutableStateOf<NfaOption?>(null) }
  var location by remember { mutableStateOf<NfaLocation?>(null) }
  var client by remember { mutableStateOf<NfaClientVendor?>(null) }
  var monthIdx by remember { mutableStateOf(Calendar.getInstance().get(Calendar.MONTH)) }
  var paymentType by remember { mutableStateOf(PAYMENT_TYPES[0]) }
  var billableType by remember { mutableStateOf(BILLABLE_TYPES[0]) }
  var billedState by remember { mutableStateOf<String?>(null) }
  var invoiceDate by remember { mutableStateOf("") }
  var invoiceAmount by remember { mutableStateOf("") }
  var expectedPaymentDate by remember { mutableStateOf("") }
  val defaultDue = remember {
    val c = Calendar.getInstance(); c.add(Calendar.DAY_OF_YEAR, 7)
    SimpleDateFormat("yyyy-MM-dd", Locale.US).format(c.time)
  }
  var settlementDueDate by remember { mutableStateOf(defaultDue) }
  var purpose by remember { mutableStateOf("") }
  var description by remember { mutableStateOf("") }
  var priority by remember { mutableStateOf("MEDIUM") }

  // Line-item entry
  var lineHeader by remember { mutableStateOf<NfaExpenseHeader?>(null) }
  var lineSubheader by remember { mutableStateOf<NfaExpenseSubheader?>(null) }
  var lineNfaAmount by remember { mutableStateOf("") }
  var lineLogAmount by remember { mutableStateOf("") }
  val lines = remember { mutableStateListOf<Triple<NfaExpenseHeader, NfaExpenseSubheader?, Pair<Double, Double>>>() }

  val m = masters.data
  // Cascades (all client-side from the single masters payload)
  val projects = m?.projects?.filter { operation == null || it.businessOperationId == null || it.businessOperationId == operation?.id } ?: emptyList()
  val categories = m?.expenseCategories?.filter { operation == null || it.businessOperationId == null || it.businessOperationId == operation?.id } ?: emptyList()
  val headers = m?.expenseHeaders?.filter { it.categoryId == category?.id } ?: emptyList()
  val subheaders = m?.expenseSubheaders?.filter { it.headerId == lineHeader?.id } ?: emptyList()

  // Approver-chain preview refreshes when the driving fields change
  LaunchedEffect(project?.id, category?.id, zone?.id) {
    if (project != null && category != null && zone != null) vm.loadPreview(project!!.id, category!!.id, zone!!.id)
  }

  val totalNfa = lines.sumOf { it.third.first }
  val totalLog = lines.sumOf { it.third.second }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Create NFA", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    if (masters.loading) { CenterLoader(); return@Column }
    masters.error?.let { ErrorState(it) { vm.loadMasters() }; return@Column }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      InfoCard {
        Text("Project Details", fontWeight = FontWeight.Bold, color = Ink)
        Spacer(Modifier.height(10.dp))
        PickerField("NFA Raise For", listOf("EXPENSE", "PURCHASE_REQUEST"), raiseFor, { if (it == "EXPENSE") "Expense" else "Purchase Request" }, { raiseFor = it })
        Spacer(Modifier.height(10.dp))
        PickerField("Business Operation", m?.businessOperations ?: emptyList(), operation, { it.name }, { operation = it; project = null; category = null })
        Spacer(Modifier.height(10.dp))
        PickerField("Cost to Company", m?.groupCompanies ?: emptyList(), company, { it.name }, { company = it })
        Spacer(Modifier.height(10.dp))
        PickerField("Select Project", projects, project, { it.name }, { project = it }, enabled = operation != null)
        Spacer(Modifier.height(10.dp))
        PickerField("Expense Category", categories, category, { it.name }, { category = it; lineHeader = null; lineSubheader = null }, enabled = operation != null)
        Spacer(Modifier.height(10.dp))
        PickerField("Cost Approval Zone", m?.costZones ?: emptyList(), zone, { it.name }, { zone = it })
        Spacer(Modifier.height(10.dp))
        PickerField("Location", m?.locations ?: emptyList(), location, { it.name }, { location = it })
        Spacer(Modifier.height(10.dp))
        PickerField("Client / Vendor", m?.clientsVendors ?: emptyList(), client, { it.name }, { client = it })
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          PickerField("Month", MONTH_NAMES.indices.toList(), monthIdx, { MONTH_NAMES[it] }, { monthIdx = it }, modifier = Modifier.weight(1f))
          DatePickField("Settlement Date", settlementDueDate, { settlementDueDate = it }, modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(10.dp))
        PickerField("Payment Type", PAYMENT_TYPES, paymentType, { it.second }, { paymentType = it })
        Spacer(Modifier.height(10.dp))
        PickerField("Billable Type", BILLABLE_TYPES, billableType, { it.second }, { billableType = it; if (it.first != "BILLABLE_CLIENT") { billedState = null } })
        if (billableType.first == "BILLABLE_CLIENT") {
          Spacer(Modifier.height(10.dp))
          PickerField("Billed / To be billed", listOf("BILLED", "TO_BE_BILLED"), billedState, { if (it == "BILLED") "Billed" else "To be billed" }, { billedState = it })
          if (billedState == "BILLED") {
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
              DatePickField("Invoice Date", invoiceDate, { invoiceDate = it }, modifier = Modifier.weight(1f))
              AppTextField(invoiceAmount, { invoiceAmount = it.filter { c -> c.isDigit() || c == '.' } }, "Invoice Amount", modifier = Modifier.weight(1f))
            }
          }
          Spacer(Modifier.height(10.dp))
          DatePickField("Expected Date of Payment", expectedPaymentDate, { expectedPaymentDate = it })
        }
      }

      // Read-only approver chain (auto-derived, like GreenHR)
      if (preview.data != null || preview.loading) {
        InfoCard {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.FactCheck, null, tint = Green, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Approval Chain", fontWeight = FontWeight.Bold, color = Ink)
          }
          Spacer(Modifier.height(8.dp))
          if (preview.loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Green)
          preview.data?.forEach { s ->
            Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
              Text("${s.seq}. ${s.roleKey.replace('_', ' ')}", color = InkSoft, style = MaterialTheme.typography.bodySmall)
              Text(s.approver?.name ?: if (s.willBypass) "— (auto bypass)" else "—", color = if (s.approver != null) Ink else InkFaint, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
            }
          }
        }
      }

      InfoCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Icon(Icons.Filled.ReceiptLong, null, tint = Green, modifier = Modifier.size(18.dp))
          Spacer(Modifier.width(8.dp))
          Text("Expense Lines", fontWeight = FontWeight.Bold, color = Ink)
        }
        Spacer(Modifier.height(10.dp))
        PickerField("Expense Header", headers, lineHeader, { it.name }, { lineHeader = it; lineSubheader = null }, enabled = category != null)
        Spacer(Modifier.height(10.dp))
        PickerField("Sub Header", subheaders, lineSubheader, { it.name }, { lineSubheader = it }, enabled = lineHeader != null)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          AppTextField(lineNfaAmount, { lineNfaAmount = it.filter { c -> c.isDigit() || c == '.' } }, "NFA Amount", modifier = Modifier.weight(1f))
          AppTextField(lineLogAmount, { lineLogAmount = it.filter { c -> c.isDigit() || c == '.' } }, "Logistic Amount", modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(10.dp))
        TextButton(onClick = {
          val h = lineHeader ?: return@TextButton
          val amt = lineNfaAmount.toDoubleOrNull() ?: 0.0
          val log = lineLogAmount.toDoubleOrNull() ?: 0.0
          if (amt + log <= 0) return@TextButton
          lines.add(Triple(h, lineSubheader, amt to log))
          lineNfaAmount = ""; lineLogAmount = ""; lineSubheader = null
        }) {
          Icon(Icons.Filled.AddCircle, null, tint = Green)
          Spacer(Modifier.width(6.dp))
          Text("Add line", color = Green, fontWeight = FontWeight.SemiBold)
        }
        lines.forEachIndexed { i, l ->
          Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
              Text(l.first.name, style = MaterialTheme.typography.bodyMedium, color = Ink, fontWeight = FontWeight.Medium)
              l.second?.let { Text(it.name, style = MaterialTheme.typography.bodySmall, color = InkFaint) }
            }
            Text("₹${"%,.0f".format(l.third.first + l.third.second)}", color = Ink, fontWeight = FontWeight.SemiBold)
            IconButton(onClick = { lines.removeAt(i) }) { Icon(Icons.Filled.Delete, null, tint = Rose, modifier = Modifier.size(18.dp)) }
          }
        }
        if (lines.isNotEmpty()) {
          HorizontalDivider(color = Line)
          Spacer(Modifier.height(8.dp))
          InfoRow("Total NFA Amount", "₹${"%,.0f".format(totalNfa)}")
          InfoRow("Total Logistic Amount", "₹${"%,.0f".format(totalLog)}")
          InfoRow("Grand Total", "₹${"%,.0f".format(totalNfa + totalLog)}")
        }
      }

      InfoCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Icon(Icons.Filled.PostAdd, null, tint = Green, modifier = Modifier.size(18.dp))
          Spacer(Modifier.width(8.dp))
          Text("Purpose & Priority", fontWeight = FontWeight.Bold, color = Ink)
        }
        Spacer(Modifier.height(10.dp))
        AppTextField(purpose, { purpose = it }, "NFA Purpose")
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(description, { description = it }, label = { Text("NFA Description") }, minLines = 2,
          shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
          modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        PickerField("Priority Level", PRIORITIES, priority, { it.lowercase().replaceFirstChar(Char::uppercase) }, { priority = it })
      }

      createError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      if (created) Text("Your NFA has been submitted.", color = Green, fontWeight = FontWeight.SemiBold)
      PrimaryButton(if (submitting) "" else "Submit NFA", loading = submitting, onClick = {
        val missing = operation == null || company == null || project == null || category == null || zone == null || location == null
        if (missing) { vm.createError.value = "Complete all Project Details fields."; return@PrimaryButton }
        vm.create(NfaCreateInput(
          raiseFor = raiseFor,
          businessOperationId = operation!!.id, groupCompanyId = company!!.id, projectId = project!!.id,
          expenseCategoryId = category!!.id, zoneId = zone!!.id, locationId = location!!.id,
          clientVendorId = client?.id, expenseMonth = monthIdx + 1,
          paymentType = paymentType.first, billableType = billableType.first, billedState = billedState,
          invoiceDate = invoiceDate.ifBlank { null }, invoiceAmount = invoiceAmount.toDoubleOrNull(),
          expectedPaymentDate = expectedPaymentDate.ifBlank { null },
          settlementDueDate = settlementDueDate, purpose = purpose.trim(), description = description.ifBlank { null },
          priority = priority,
          lines = lines.map { NfaLineInput(it.first.id, it.second?.id, it.third.first, it.third.second) },
        ))
      }, modifier = Modifier.fillMaxWidth())
      Spacer(Modifier.height(8.dp))
    }
  }
}
