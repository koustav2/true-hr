package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Mail
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.TeamMate
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.NoTeamState
import com.truehr.app.presentation.components.initials
import com.truehr.app.presentation.theme.*

@Composable
fun TeamListScreen(onBack: () -> Unit, vm: TeamListViewModel = hiltViewModel()) {
  val s by vm.list.collectAsState()
  var q by remember { mutableStateOf("") }
  var selected by remember { mutableStateOf<TeamMate?>(null) }
  LaunchedEffect(Unit) { vm.load() }

  selected?.let { TeamMateDialog(it) { selected = null } }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Column {
          Text("Team List", color = Surface, style = MaterialTheme.typography.titleLarge)
          val n = s.data?.size
          if (n != null) Text("$n ${if (n == 1) "member" else "members"} reporting to you", color = Surface.copy(alpha = 0.9f), style = MaterialTheme.typography.bodyMedium)
        }
      }
    }
    OutlinedTextField(
      value = q, onValueChange = { q = it },
      placeholder = { Text("Search name, ID, designation…") },
      leadingIcon = { Icon(Icons.Filled.Search, null, tint = Green) },
      singleLine = true, shape = RoundedCornerShape(14.dp),
      colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
      modifier = Modifier.fillMaxWidth().padding(14.dp),
    )
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load() })
      else -> {
        val list = (s.data ?: emptyList()).filter {
          q.isBlank() || "${it.name} ${it.employeeCode} ${it.designation} ${it.department} ${it.state}".contains(q, ignoreCase = true)
        }
        // Group state-wise, alphabetically; unknown states fall under "Other".
        val grouped = list.groupBy { it.state?.takeIf { s -> s.isNotBlank() } ?: "Other" }
          .toSortedMap(compareBy { if (it == "Other") "￿" else it })
        if (list.isEmpty() && q.isBlank()) NoTeamState()
        else if (list.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          Text("No matches.", color = InkSoft)
        } else LazyColumn(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
          grouped.forEach { (state, members) ->
            item(key = "h_$state") { StateHeader(state, members.size) }
            items(members, key = { it.employeeCode }) { TeamMateCard(it, onClick = { selected = it }) }
          }
        }
      }
    }
  }
}

@Composable
private fun StateHeader(state: String, count: Int) {
  Row(
    Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 2.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(Icons.Filled.Place, null, tint = Green, modifier = Modifier.size(16.dp))
    Spacer(Modifier.width(6.dp))
    Text(state.uppercase(), color = Green, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
    Spacer(Modifier.width(8.dp))
    Surface(color = Green.copy(alpha = 0.12f), shape = RoundedCornerShape(20.dp)) {
      Text("$count", color = Green, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
    }
    Spacer(Modifier.width(10.dp))
    HorizontalDivider(color = Line, modifier = Modifier.weight(1f))
  }
}

@Composable
private fun TeamMateCard(m: TeamMate, onClick: () -> Unit) {
  Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp, border = androidx.compose.foundation.BorderStroke(1.dp, Line),
    modifier = Modifier.clickable(onClick = onClick)) {
    Column(Modifier.padding(16.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(46.dp).clip(CircleShape).background(Green.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
          Text(initials(m.name), color = Green, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
          Text(m.name, fontWeight = FontWeight.Bold, color = Ink)
          Text("${m.employeeCode}  ·  ${m.designation ?: "—"}", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
          if (!m.department.isNullOrBlank()) Text(m.department, color = InkSoft, style = MaterialTheme.typography.labelMedium)
        }
      }
      if (!m.email.isNullOrBlank() || !m.phone.isNullOrBlank()) {
        Spacer(Modifier.height(10.dp))
        HorizontalDivider(color = Line)
        Spacer(Modifier.height(10.dp))
        if (!m.email.isNullOrBlank()) ContactRow(Icons.Filled.Mail, m.email)
        if (!m.phone.isNullOrBlank()) { Spacer(Modifier.height(6.dp)); ContactRow(Icons.Filled.Phone, m.phone) }
      }
    }
  }
}

@Composable
private fun ContactRow(icon: ImageVector, value: String) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Icon(icon, null, tint = InkFaint, modifier = Modifier.size(15.dp))
    Spacer(Modifier.width(8.dp))
    Text(value, color = InkSoft, style = MaterialTheme.typography.bodyMedium)
  }
}

@Composable
private fun TeamMateDialog(m: TeamMate, onDismiss: () -> Unit) {
  AlertDialog(
    onDismissRequest = onDismiss,
    modifier = Modifier.fillMaxWidth(0.95f),
    properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
    confirmButton = { TextButton(onClick = onDismiss) { Text("Close", color = Green) } },
    title = {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp).clip(CircleShape).background(Green.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
          Text(initials(m.name), color = Green, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(12.dp))
        Text(m.name, fontWeight = FontWeight.Bold, color = Ink)
      }
    },
    text = {
      Column {
        DetailRow("Name", m.name)
        DetailRow("Official email", m.email)
        DetailRow("Employee code", m.employeeCode)
        DetailRow("Designation", m.designation)
        DetailRow("State", m.state)
        DetailRow("Mobile", m.phone)
        DetailRow("Reporting manager", m.reportingManager)
        DetailRow("Functional manager", m.functionalManager)
      }
    },
  )
}

@Composable
private fun DetailRow(label: String, value: String?) {
  Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
    Text(label, color = InkFaint, modifier = Modifier.width(140.dp), style = MaterialTheme.typography.bodyMedium)
    Text(value?.takeIf { it.isNotBlank() } ?: "—", color = Ink, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
  }
}
