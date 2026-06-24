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
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.TeamMate
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.NoTeamState
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

private val ISO_T = SimpleDateFormat("yyyy-MM-dd", Locale.US)
private val SHOW_T = SimpleDateFormat("dd/MM/yyyy", Locale.getDefault())

@Composable
fun AssignTaskScreen(onBack: () -> Unit, vm: TaskViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val context = LocalContext.current
  val members by vm.teamMembers.collectAsState()
  val prof by profileVm.state.collectAsState()
  val noTeam = prof.data?.isManager == false
  val submitting by vm.submitting.collectAsState()
  val message by vm.message.collectAsState()
  val created by vm.created.collectAsState()

  LaunchedEffect(Unit) { vm.loadTeamMembers() }
  LaunchedEffect(message) { message?.let { Toast.makeText(context, it, Toast.LENGTH_SHORT).show(); vm.consumeMessage() } }
  LaunchedEffect(created) { if (created) { Toast.makeText(context, "Task assigned", Toast.LENGTH_SHORT).show(); onBack() } }

  var selected by remember { mutableStateOf<TeamMate?>(null) }
  var expanded by remember { mutableStateOf(false) }
  var title by remember { mutableStateOf("") }
  var desc by remember { mutableStateOf("") }
  var aroundTime by remember { mutableStateOf("") }
  val dueCal = remember { Calendar.getInstance() }
  var dueText by remember { mutableStateOf(SHOW_T.format(dueCal.time)) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Assign Task", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    if (noTeam) { NoTeamState("You can assign tasks only to team members reporting to you."); return@Column }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      // Assignee dropdown
      Column {
        Text("Assign to *", color = InkSoft, style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.height(4.dp))
        Box {
          Surface(color = Surface, shape = RoundedCornerShape(12.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Line),
            modifier = Modifier.fillMaxWidth().clickable { expanded = true }) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
              Text(selected?.name ?: "Select team member", color = if (selected == null) InkFaint else Ink, modifier = Modifier.weight(1f))
              Icon(Icons.Filled.ArrowDropDown, null, tint = InkFaint)
            }
          }
          DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            members.forEach { m ->
              DropdownMenuItem(text = { Text("${m.name}  ·  ${m.employeeCode}") }, onClick = { selected = m; expanded = false })
            }
            if (members.isEmpty()) DropdownMenuItem(text = { Text("No team members") }, onClick = { expanded = false })
          }
        }
      }

      Field2("Task title *") { OutlinedTextField(title, { title = it }, singleLine = true, placeholder = { Text("What needs to be done") }, shape = RoundedCornerShape(12.dp), colors = fieldColors(), modifier = Modifier.fillMaxWidth()) }
      Field2("Description") { OutlinedTextField(desc, { desc = it }, minLines = 3, placeholder = { Text("Details…") }, shape = RoundedCornerShape(12.dp), colors = fieldColors(), modifier = Modifier.fillMaxWidth()) }

      Column {
        Text("Due date", color = InkSoft, style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.height(4.dp))
        Surface(color = Surface, shape = RoundedCornerShape(12.dp), border = androidx.compose.foundation.BorderStroke(1.dp, Line),
          modifier = Modifier.fillMaxWidth().clickable {
            DatePickerDialog(context, { _, y, m, d -> dueCal.set(y, m, d); dueText = SHOW_T.format(dueCal.time) },
              dueCal.get(Calendar.YEAR), dueCal.get(Calendar.MONTH), dueCal.get(Calendar.DAY_OF_MONTH)).show()
          }) {
          Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.CalendarMonth, null, tint = Teal, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(10.dp)); Text(dueText, color = Ink)
          }
        }
      }
      Field2("Around time (optional)") { OutlinedTextField(aroundTime, { aroundTime = it }, singleLine = true, placeholder = { Text("e.g. 2h, EOD") }, shape = RoundedCornerShape(12.dp), colors = fieldColors(), modifier = Modifier.fillMaxWidth()) }

      Button(
        onClick = { selected?.let { vm.assign(it.id, title, desc, ISO_T.format(dueCal.time), aroundTime) } },
        enabled = !submitting && selected != null && title.isNotBlank(),
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Green, contentColor = Surface),
        modifier = Modifier.fillMaxWidth().height(50.dp),
      ) {
        if (submitting) CircularProgressIndicator(color = Surface, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        else Text("Assign Task", fontWeight = FontWeight.Bold)
      }
    }
  }
}

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green, focusedLabelColor = Green, cursorColor = Green)

@Composable
private fun Field2(label: String, content: @Composable () -> Unit) {
  Column {
    Text(label, color = InkSoft, style = MaterialTheme.typography.labelMedium)
    Spacer(Modifier.height(4.dp))
    content()
  }
}
