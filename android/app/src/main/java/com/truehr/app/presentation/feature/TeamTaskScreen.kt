package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AddTask
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.Task
import com.truehr.app.domain.model.TeamTaskSummary
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.NoTeamState
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*

private val T_FILTERS = listOf("PENDING" to "Pending", "ONGOING" to "Ongoing", "CLOSED" to "Closed", null to "All")

@Composable
fun TeamTaskScreen(onAssign: () -> Unit, onBack: () -> Unit, vm: TaskViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  var tab by remember { mutableStateOf(0) }
  val sum by vm.teamSummary.collectAsState()
  val tasks by vm.teamTasks.collectAsState()
  val prof by profileVm.state.collectAsState()
  val noTeam = prof.data?.isManager == false
  LaunchedEffect(tab) { vm.loadTeam(T_FILTERS[tab].first) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Team Tasks", color = Surface, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        if (!noTeam) TextButton(onClick = onAssign) {
          Icon(Icons.Filled.Add, null, tint = Surface); Spacer(Modifier.width(4.dp)); Text("Assign", color = Surface, fontWeight = FontWeight.SemiBold)
        }
      }
    }
    if (noTeam) { NoTeamState(); return@Column }

    if (!noTeam) ScrollableTabRow(selectedTabIndex = tab, containerColor = Surface, contentColor = Green, edgePadding = 14.dp) {
      T_FILTERS.forEachIndexed { i, (_, label) -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(label) }) }
    }
    val list = tasks.data ?: emptyList()
    val fullyEmpty = sum.data.isNullOrEmpty() && list.isEmpty()
    when {
      sum.loading -> CenterLoader()
      sum.error != null -> ErrorState(sum.error!!, onRetry = { vm.loadTeam(T_FILTERS[tab].first) })
      fullyEmpty -> EmptyTasks(onAssign)
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!sum.data.isNullOrEmpty()) {
          item { Text("PER-EMPLOYEE SUMMARY", color = InkFaint, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelSmall) }
          items(sum.data!!) { SummaryRow(it) }
          item { Spacer(Modifier.height(4.dp)); Text("${T_FILTERS[tab].second.uppercase()} TASKS", color = InkFaint, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelSmall) }
        }
        if (list.isEmpty()) item {
          Surface(color = Surface, shape = RoundedCornerShape(14.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Line), modifier = Modifier.fillMaxWidth()) {
            Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
              Text("No ${T_FILTERS[tab].second.lowercase()} tasks.", color = InkSoft)
            }
          }
        }
        else items(list) { TeamTaskCard(it) }
      }
    }
  }
}

@Composable
private fun EmptyTasks(onAssign: () -> Unit) {
  Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
    Box(Modifier.size(76.dp).clip(CircleShape).background(Green.copy(alpha = 0.10f)), contentAlignment = Alignment.Center) {
      Icon(Icons.Filled.AddTask, null, tint = Green, modifier = Modifier.size(38.dp))
    }
    Spacer(Modifier.height(16.dp))
    Text("No tasks yet", style = MaterialTheme.typography.titleMedium, color = Ink, fontWeight = FontWeight.Bold)
    Spacer(Modifier.height(6.dp))
    Text("Assign a task to your team and track its progress here.", color = InkSoft, style = MaterialTheme.typography.bodyMedium, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    Spacer(Modifier.height(20.dp))
    Button(onClick = onAssign, shape = RoundedCornerShape(12.dp), colors = ButtonDefaults.buttonColors(containerColor = Green, contentColor = Surface), modifier = Modifier.height(48.dp)) {
      Icon(Icons.Filled.Add, null); Spacer(Modifier.width(6.dp)); Text("Assign a task", fontWeight = FontWeight.SemiBold)
    }
  }
}

@Composable
private fun SummaryRow(s: TeamTaskSummary) {
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
    Column(Modifier.padding(14.dp)) {
      Text(s.name ?: s.employeeCode ?: "—", fontWeight = FontWeight.Bold, color = Ink)
      Text(s.employeeCode ?: "", color = InkFaint, style = MaterialTheme.typography.labelSmall)
      Spacer(Modifier.height(8.dp))
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Mini("Total", s.total, Sky, Modifier.weight(1f))
        Mini("Pending", s.pending, Amber, Modifier.weight(1f))
        Mini("Ongoing", s.ongoing, Grape, Modifier.weight(1f))
        Mini("Closed", s.closed, Green, Modifier.weight(1f))
      }
    }
  }
}

@Composable
private fun Mini(label: String, n: Int, color: androidx.compose.ui.graphics.Color, modifier: Modifier) {
  Surface(color = color.copy(alpha = 0.10f), shape = RoundedCornerShape(10.dp), modifier = modifier) {
    Column(Modifier.padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Text("$n", color = color, fontWeight = FontWeight.Bold)
      Text(label, color = InkSoft, style = MaterialTheme.typography.labelSmall)
    }
  }
}

@Composable
private fun TeamTaskCard(t: Task) {
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp, border = androidx.compose.foundation.BorderStroke(1.dp, Line)) {
    Column(Modifier.padding(14.dp)) {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(t.title, fontWeight = FontWeight.Bold, color = Ink, modifier = Modifier.weight(1f))
        TaskStatusPill(t.status)
      }
      Text("${t.assignedToName ?: ""}  ·  ${t.assignedToCode ?: ""}", color = Sky, style = MaterialTheme.typography.labelMedium)
      if (!t.description.isNullOrBlank()) { Spacer(Modifier.height(4.dp)); Text(t.description, color = InkSoft, style = MaterialTheme.typography.bodyMedium) }
      t.dueDate?.let { Spacer(Modifier.height(4.dp)); Text("Due: ${taskDmy(it)}", color = InkFaint, style = MaterialTheme.typography.labelMedium) }
    }
  }
}
