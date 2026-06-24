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
import com.truehr.app.domain.model.Task
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*

private val FILTERS = listOf(null to "All", "PENDING" to "Pending", "ONGOING" to "Ongoing", "CLOSED" to "Closed")

@Composable
fun TaskSummaryScreen(onBack: () -> Unit, vm: TaskViewModel = hiltViewModel()) {
  var tab by remember { mutableStateOf(0) }
  val s by vm.myTasks.collectAsState()
  val summary by vm.summary.collectAsState()
  val busy by vm.statusBusy.collectAsState()
  LaunchedEffect(tab) { vm.loadMine(FILTERS[tab].first) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Task Summary", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    // Summary chips
    summary?.let { sm ->
      Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        SummaryChip("Total", sm.total, Sky, Modifier.weight(1f))
        SummaryChip("Pending", sm.pending, Amber, Modifier.weight(1f))
        SummaryChip("Ongoing", sm.ongoing, Grape, Modifier.weight(1f))
        SummaryChip("Closed", sm.closed, Green, Modifier.weight(1f))
      }
    }
    ScrollableTabRow(selectedTabIndex = tab, containerColor = Surface, contentColor = Green, edgePadding = 14.dp) {
      FILTERS.forEachIndexed { i, (_, label) -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) }) }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.loadMine(FILTERS[tab].first) })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No tasks here.", color = InkSoft) }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(s.data!!) { t ->
          TaskCard(t, busy = busy == t.id,
            onStart = { vm.setStatus(t.id, "ONGOING", null, FILTERS[tab].first) },
            onClose = { vm.setStatus(t.id, "CLOSED", null, FILTERS[tab].first) })
        }
      }
    }
  }
}

@Composable
private fun SummaryChip(label: String, n: Int, color: Color, modifier: Modifier) {
  Surface(color = color.copy(alpha = 0.10f), shape = RoundedCornerShape(12.dp), modifier = modifier) {
    Column(Modifier.padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Text("$n", color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
      Text(label, color = InkSoft, style = MaterialTheme.typography.labelSmall)
    }
  }
}

fun statusColor(status: String): Color = when (status) { "CLOSED" -> Green; "ONGOING" -> Grape; else -> Amber }

@Composable
fun TaskStatusPill(status: String) {
  val c = statusColor(status)
  Surface(color = c.copy(alpha = 0.14f), shape = RoundedCornerShape(20.dp)) {
    Text(status.lowercase().replaceFirstChar { it.uppercase() }, color = c, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
  }
}

@Composable
private fun TaskCard(t: Task, busy: Boolean, onStart: () -> Unit, onClose: () -> Unit) {
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
    Column(Modifier.padding(16.dp)) {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(t.title, fontWeight = FontWeight.Bold, color = Ink, modifier = Modifier.weight(1f))
        TaskStatusPill(t.status)
      }
      if (!t.description.isNullOrBlank()) { Spacer(Modifier.height(4.dp)); Text(t.description, color = InkSoft, style = MaterialTheme.typography.bodyMedium) }
      Spacer(Modifier.height(8.dp))
      Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        t.dueDate?.let { Text("Due: ${dmyT(it)}", color = InkFaint, style = MaterialTheme.typography.labelMedium) }
        t.aroundTime?.let { Text("Time: $it", color = InkFaint, style = MaterialTheme.typography.labelMedium) }
      }
      if (!t.assignedByName.isNullOrBlank()) Text("Assigned by ${t.assignedByName}", color = InkFaint, style = MaterialTheme.typography.labelSmall)
      if (t.status != "CLOSED") {
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          if (t.status == "PENDING") {
            OutlinedButton(onClick = onStart, enabled = !busy, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = Grape)) {
              Text("Start", fontWeight = FontWeight.SemiBold)
            }
          }
          Button(onClick = onClose, enabled = !busy, modifier = Modifier.weight(1f), shape = RoundedCornerShape(10.dp), colors = ButtonDefaults.buttonColors(containerColor = Green, contentColor = Surface)) {
            if (busy) CircularProgressIndicator(color = Surface, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            else Text("Mark Closed", fontWeight = FontWeight.SemiBold)
          }
        }
      }
    }
  }
}

internal fun dmyT(iso: String): String {
  val p = iso.take(10).split("-")
  return if (p.size == 3) "${p[2]}/${p[1]}/${p[0]}" else iso
}
