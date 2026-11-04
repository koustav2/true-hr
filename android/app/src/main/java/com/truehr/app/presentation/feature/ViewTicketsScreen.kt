package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.SupportTicket
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private val ISO_T = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ViewTicketsScreen(category: String, onBack: () -> Unit, vm: SupportViewModel = hiltViewModel()) {
  val s by vm.list.collectAsState()
  val withDates = category != "HR"
  val title = when (category) { "HR" -> "HR Ticket Details"; "IT" -> "IT Ticket Details"; else -> "View Admin Support" }

  val today = remember { com.truehr.app.core.Dates.todayIso() }
  var from by remember { mutableStateOf(com.truehr.app.core.Dates.addDays(today, -30)) }
  var to by remember { mutableStateOf(today) }
  var picker by remember { mutableStateOf<String?>(null) }

  val detail by vm.detail.collectAsState()
  if (detail.loading || detail.data != null || detail.error != null) TicketDetailDialog(vm, detail)

  LaunchedEffect(from, to) {
    if (withDates) vm.load(category, from, to) else vm.load(category)
  }

  if (picker != null) {
    val st = rememberDatePickerState()
    DatePickerDialog(
      onDismissRequest = { picker = null },
      confirmButton = { TextButton(onClick = { st.selectedDateMillis?.let { val v = ISO_T.format(Date(it)); if (picker == "FROM") from = v else to = v }; picker = null }) { Text("OK") } },
      dismissButton = { TextButton(onClick = { picker = null }) { Text("Cancel") } },
    ) { DatePicker(state = st) }
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text(title, color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    if (withDates) {
      Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        DateBox("From Date", from, Modifier.weight(1f)) { picker = "FROM" }
        DateBox("To Date", to, Modifier.weight(1f)) { picker = "TO" }
      }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { if (withDates) vm.load(category, from, to) else vm.load(category) })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No tickets found.", color = InkSoft) }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(s.data!!) { t -> TicketCard(t) { vm.openDetail(t.id) } }
      }
    }
  }
}

@Composable
private fun DateBox(label: String, value: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
  OutlinedTextField(value = dmyT(value), onValueChange = {}, readOnly = true, enabled = false, label = { Text(label) },
    trailingIcon = { Icon(Icons.Filled.CalendarMonth, null, tint = Green) },
    shape = RoundedCornerShape(12.dp),
    colors = OutlinedTextFieldDefaults.colors(disabledBorderColor = Line, disabledLabelColor = Green, disabledTextColor = Ink, disabledTrailingIconColor = Green),
    modifier = modifier.clickable(onClick = onClick))
}

@Composable
private fun TicketCard(t: SupportTicket, onView: () -> Unit) {
  val statusColor = when (t.status) { "RESOLVED", "CLOSED" -> Green; "CANCELLED" -> InkFaint; else -> Sky }
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth().clickable(onClick = onView)) {
    Column(Modifier.padding(16.dp)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          // E42: ticket number and date.
          Text("Ticket #${t.ticketNo ?: t.id}", fontWeight = FontWeight.Bold, color = Green)
          t.appliedAt?.let { Text("Raised on ${com.truehr.app.core.Dates.dmyTime(it)}", color = InkFaint, style = MaterialTheme.typography.labelSmall) }
        }
        Surface(color = statusColor.copy(alpha = 0.14f), shape = RoundedCornerShape(20.dp)) {
          Text(com.truehr.app.core.Labels.of(t.status), color = statusColor,
            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
        }
      }
      HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 10.dp))
      t.subject?.takeIf { it.isNotBlank() }?.let { Text(it, color = Ink, fontWeight = FontWeight.SemiBold) }
      Text("${t.issueType}${t.issueDetail?.let { " · $it" } ?: ""}", color = InkSoft, style = MaterialTheme.typography.bodyMedium)
      if (!t.description.isNullOrBlank()) {
        Spacer(Modifier.height(4.dp))
        // Long unbroken text wraps inside the card (no sideways scroll).
        Text(t.description, color = InkSoft, style = MaterialTheme.typography.bodyMedium, maxLines = 4,
          overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, softWrap = true)
      }
      if (!t.resolutionNote.isNullOrBlank()) {
        Spacer(Modifier.height(4.dp))
        Text("Resolution: ${t.resolutionNote}", color = Green, style = MaterialTheme.typography.bodyMedium)
      }
      Spacer(Modifier.height(6.dp))
      Text("View details & reply", color = Sky, style = MaterialTheme.typography.labelMedium)
    }
  }
}

/** E42: full ticket with its updates; reply, cancel (while open) and reopen (after resolved). */
@Composable
private fun TicketDetailDialog(vm: SupportViewModel, st: com.truehr.app.core.UiState<com.truehr.app.domain.model.TicketDetail>) {
  val busy by vm.detailBusy.collectAsState()
  val err by vm.detailError.collectAsState()
  var reply by remember { mutableStateOf("") }
  var confirmCancel by remember { mutableStateOf(false) }
  val d = st.data
  if (confirmCancel && d != null) {
    com.truehr.app.presentation.components.ConfirmDialog("Cancel this ticket?", "The support desk will stop working on it.", "Cancel ticket",
      onConfirm = { confirmCancel = false; vm.cancel(d.ticket.id) }, onDismiss = { confirmCancel = false }, dismissLabel = "Keep it")
  }
  AlertDialog(
    onDismissRequest = { vm.closeDetail() },
    title = { Text(d?.let { "Ticket #${it.ticket.ticketNo ?: it.ticket.id}" } ?: "Ticket") },
    text = {
      Column(Modifier.heightIn(max = 460.dp).verticalScroll(androidx.compose.foundation.rememberScrollState())) {
        when {
          st.loading -> CircularProgressIndicator(color = Green)
          st.error != null -> Text(st.error!!, color = Rose)
          d != null -> {
            val t = d.ticket
            Text(com.truehr.app.core.Labels.of(t.status), color = Sky, fontWeight = FontWeight.SemiBold)
            t.subject?.let { Text(it, color = Ink, fontWeight = FontWeight.SemiBold) }
            Text("${t.issueType}${t.issueDetail?.let { " · $it" } ?: ""}", color = InkSoft, style = MaterialTheme.typography.bodySmall)
            t.description?.let { Spacer(Modifier.height(6.dp)); Text(it, color = Ink, style = MaterialTheme.typography.bodyMedium) }
            if (d.comments.isNotEmpty()) {
              Spacer(Modifier.height(10.dp)); Text("Updates", fontWeight = FontWeight.Bold, color = Ink)
              d.comments.forEach { c ->
                Spacer(Modifier.height(6.dp))
                Text("${c.author} · ${com.truehr.app.core.Dates.dmyTime(c.at)}", color = InkFaint, style = MaterialTheme.typography.labelSmall)
                Text(c.body, color = Ink, style = MaterialTheme.typography.bodyMedium)
              }
            }
            if (t.status !in setOf("CLOSED", "CANCELLED")) {
              Spacer(Modifier.height(10.dp))
              OutlinedTextField(reply, { reply = it.take(2000) }, label = { Text(if (t.canReopen) "Reason for reopening" else "Reply") }, minLines = 2, modifier = Modifier.fillMaxWidth())
            }
            err?.let { Spacer(Modifier.height(6.dp)); Text(it, color = Rose, style = MaterialTheme.typography.bodySmall) }
          }
        }
      }
    },
    confirmButton = {
      val t = d?.ticket
      if (t != null && t.status !in setOf("CLOSED", "CANCELLED")) {
        TextButton(enabled = !busy, onClick = {
          val ok = if (t.canReopen) vm.reopen(t.id, reply) else vm.reply(t.id, reply)
          if (ok) reply = ""
        }) { Text(if (t.canReopen) "Reopen" else "Send reply", color = Green) }
      }
    },
    dismissButton = {
      Row {
        if (d?.ticket?.canCancel == true) TextButton(enabled = !busy, onClick = { confirmCancel = true }) { Text("Cancel ticket", color = Rose) }
        TextButton(onClick = { vm.closeDetail() }) { Text("Close") }
      }
    },
  )
}

private fun dmyT(iso: String): String {
  val p = iso.take(10).split("-")
  return if (p.size == 3) "${p[2]}/${p[1]}/${p[0]}" else iso
}
