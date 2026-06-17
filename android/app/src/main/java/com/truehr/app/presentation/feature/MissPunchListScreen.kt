package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.MissPunch
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*

private val TABS = listOf("PENDING" to "Pending", "APPROVED" to "Approved", "REJECTED" to "Rejected")

@Composable
fun MissPunchListScreen(title: String, teamView: Boolean, onBack: () -> Unit, vm: MissPunchViewModel = hiltViewModel()) {
  var tab by remember { mutableStateOf(0) }
  val s by vm.list.collectAsState()
  LaunchedEffect(tab) { vm.load(TABS[tab].first, teamView) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text(title, color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    TabRow(selectedTabIndex = tab, containerColor = Surface, contentColor = Green) {
      TABS.forEachIndexed { i, (_, label) ->
        Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) })
      }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load(TABS[tab].first, teamView) })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text("No ${TABS[tab].second.lowercase()} requests.", color = InkSoft)
      }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(s.data!!) { MissPunchCard(it) }
      }
    }
  }
}

@Composable
private fun MissPunchCard(m: MissPunch) {
  val statusColor = when (m.status) { "APPROVED" -> Green; "REJECTED" -> Rose; else -> Amber }
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
    Column(Modifier.padding(16.dp)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Column {
          Text(m.name, fontWeight = FontWeight.Bold, color = Ink)
          Text("Emp Code: ${m.employeeCode}", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
        }
        Surface(color = statusColor.copy(alpha = 0.12f), shape = RoundedCornerShape(20.dp)) {
          Text(m.status.lowercase().replaceFirstChar { it.uppercase() }, color = statusColor,
            style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
        }
      }
      HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 10.dp))
      KV("Request Date", m.days)
      KV("Month", m.month)
      KV("Year", m.year.toString())
      KV("Apply Date", m.appliedAt ?: "—")
      if (m.reviewedAt != null) KV("Reviewed On", m.reviewedAt)
      if (!m.remarks.isNullOrBlank()) KV("Remarks", m.remarks)
    }
  }
}

@Composable
private fun KV(k: String, v: String) {
  Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
    Text(k, color = InkFaint, modifier = Modifier.width(120.dp), style = MaterialTheme.typography.bodyMedium)
    Text(v, color = Ink, fontWeight = FontWeight.Medium, style = MaterialTheme.typography.bodyMedium)
  }
}
