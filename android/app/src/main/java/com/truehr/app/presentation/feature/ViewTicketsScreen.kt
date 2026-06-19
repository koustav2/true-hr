package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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

  val today = remember { ISO_T.format(Date()) }
  var from by remember { mutableStateOf(today) }
  var to by remember { mutableStateOf(today) }
  var picker by remember { mutableStateOf<String?>(null) }

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
        items(s.data!!) { TicketCard(it) }
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
private fun TicketCard(t: SupportTicket) {
  val statusColor = when (t.status) { "RESOLVED" -> Green; else -> Sky }
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
    Column(Modifier.padding(16.dp)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
          Text("Ticket ID: ${t.id}", fontWeight = FontWeight.Bold, color = Green)
          t.appliedAt?.let { Text("Applied on: ${dmyT(it)}", color = InkFaint, style = MaterialTheme.typography.labelSmall) }
        }
        Surface(color = statusColor.copy(alpha = 0.14f), shape = RoundedCornerShape(20.dp)) {
          Text(t.status.lowercase().replaceFirstChar { it.uppercase() }, color = statusColor,
            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
        }
      }
      HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 10.dp))
      Text(t.name, color = Ink, fontWeight = FontWeight.SemiBold)
      if (!t.email.isNullOrBlank()) Text(t.email, color = InkSoft, style = MaterialTheme.typography.bodyMedium)
      if (!t.phone.isNullOrBlank()) Text(t.phone, color = InkSoft, style = MaterialTheme.typography.bodyMedium)
      HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 10.dp))
      Text("Issue Details", fontWeight = FontWeight.Bold, color = Ink)
      Spacer(Modifier.height(4.dp))
      Text("Issue Type: ${t.issueType}${t.issueDetail?.let { " · $it" } ?: ""}", color = InkSoft, style = MaterialTheme.typography.bodyMedium)
      if (!t.description.isNullOrBlank()) {
        Spacer(Modifier.height(2.dp))
        Text("Issue Description: ${t.description}", color = InkSoft, style = MaterialTheme.typography.bodyMedium)
      }
      if (!t.resolutionNote.isNullOrBlank()) {
        Spacer(Modifier.height(2.dp))
        Text("Resolution: ${t.resolutionNote}", color = Green, style = MaterialTheme.typography.bodyMedium)
      }
    }
  }
}

private fun dmyT(iso: String): String {
  val p = iso.take(10).split("-")
  return if (p.size == 3) "${p[2]}/${p[1]}/${p[0]}" else iso
}
