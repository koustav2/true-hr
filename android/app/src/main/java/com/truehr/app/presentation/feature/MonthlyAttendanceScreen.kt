package com.truehr.app.presentation.feature

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*
import java.util.Calendar

private fun statusColor(s: String?): Color? = when (s) {
  "P" -> Green; "A" -> Rose; "L" -> Sky; "WO" -> Amber; "H" -> InkFaint; else -> null
}

@Composable
fun MonthlyAttendanceScreen(onBack: () -> Unit, employeeId: Long? = null, name: String? = null, vm: AttendanceViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val s by vm.monthly.collectAsState()
  val year by vm.curYear.collectAsState()
  val month by vm.curMonth.collectAsState()
  val profile by profileVm.state.collectAsState()
  LaunchedEffect(Unit) { vm.loadMonthly(employeeId) }

  val nowCal = remember { Calendar.getInstance() }
  val isCurrentMonth = year == nowCal.get(Calendar.YEAR) && month == nowCal.get(Calendar.MONTH) + 1
  val today = nowCal.get(Calendar.DAY_OF_MONTH)

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
          IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
          Text("Monthly Attendance", color = Surface, style = MaterialTheme.typography.titleLarge)
        }
        if (!name.isNullOrBlank()) {
          Text(name, color = Surface.copy(alpha = 0.9f), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 8.dp, top = 2.dp))
        }
        if (name.isNullOrBlank()) profile.data?.let {
          Text("${it.fullName}  ·  ${it.employeeCode}", color = Surface.copy(alpha = 0.9f),
            style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(start = 8.dp, top = 2.dp))
        }
      }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
      Surface(color = Surface, shape = RoundedCornerShape(20.dp), shadowElevation = 1.dp, border = BorderStroke(1.dp, Line)) {
        Column(Modifier.padding(16.dp)) {
          // Month switcher
          Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            FilledTonalIconButton(onClick = { vm.changeMonth(-1) }, colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = Green.copy(alpha = 0.10f))) {
              Icon(Icons.Filled.ChevronLeft, null, tint = Green)
            }
            Text(s.data?.monthLabel ?: "$month/$year", fontWeight = FontWeight.Bold, color = Ink, style = MaterialTheme.typography.titleMedium)
            FilledTonalIconButton(onClick = { vm.changeMonth(1) }, colors = IconButtonDefaults.filledTonalIconButtonColors(containerColor = Green.copy(alpha = 0.10f))) {
              Icon(Icons.Filled.ChevronRight, null, tint = Green)
            }
          }

          when {
            s.loading -> Box(Modifier.fillMaxWidth().height(280.dp), Alignment.Center) { CircularProgressIndicator(color = Green) }
            s.error != null -> ErrorState(s.error!!, onRetry = { vm.loadMonthly() })
            s.data != null -> {
              val cells = s.data!!.cells
              val statusOf = cells.associate { it.day to it.status }
              val count = { st: String -> cells.count { it.status == st } }

              // Summary chips
              Spacer(Modifier.height(14.dp))
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatChip("Present", count("P"), Green, Modifier.weight(1f))
                StatChip("Absent", count("A"), Rose, Modifier.weight(1f))
                StatChip("Leave", count("L"), Sky, Modifier.weight(1f))
                StatChip("WO", count("WO"), Amber, Modifier.weight(1f))
              }
              Spacer(Modifier.height(16.dp))
              HorizontalDivider(color = Line)
              Spacer(Modifier.height(10.dp))

              // Weekday header
              Row(Modifier.fillMaxWidth()) {
                listOf("S", "M", "T", "W", "T", "F", "S").forEach {
                  Text(it, Modifier.weight(1f), color = InkFaint, textAlign = TextAlign.Center, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
                }
              }
              Spacer(Modifier.height(4.dp))

              val cal = Calendar.getInstance().apply { set(year, month - 1, 1) }
              val lead = cal.get(Calendar.DAY_OF_WEEK) - 1
              val grid = buildList<Int?> { repeat(lead) { add(null) }; cells.forEach { add(it.day) } }
              grid.chunked(7).forEach { week ->
                Row(Modifier.fillMaxWidth()) {
                  for (i in 0 until 7) {
                    val day = week.getOrNull(i)
                    Box(Modifier.weight(1f).aspectRatio(1f).padding(3.dp), contentAlignment = Alignment.Center) {
                      if (day != null) DayCell(day, statusOf[day], isToday = isCurrentMonth && day == today)
                    }
                  }
                }
              }

              Spacer(Modifier.height(14.dp))
              HorizontalDivider(color = Line)
              Spacer(Modifier.height(10.dp))
              FlowLegend()
            }
          }
        }
      }
      Spacer(Modifier.height(16.dp))
    }
  }
}

@Composable
private fun DayCell(day: Int, status: String?, isToday: Boolean) {
  val c = statusColor(status)
  val bg = c?.copy(alpha = 0.16f) ?: Color.Transparent
  Box(
    Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp)).background(bg)
      .then(if (isToday) Modifier.border(2.dp, Green, RoundedCornerShape(12.dp)) else Modifier),
    contentAlignment = Alignment.Center,
  ) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
      Text(day.toString(), color = c ?: Ink, fontWeight = if (c != null || isToday) FontWeight.Bold else FontWeight.Normal, style = MaterialTheme.typography.bodyMedium)
      if (status == "WO") Text("WO", color = Amber, style = MaterialTheme.typography.labelSmall)
    }
  }
}

@Composable
private fun StatChip(label: String, value: Int, color: Color, modifier: Modifier = Modifier) {
  Surface(color = color.copy(alpha = 0.10f), shape = RoundedCornerShape(12.dp), modifier = modifier) {
    Column(Modifier.padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Text(value.toString(), color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
      Text(label, color = InkSoft, style = MaterialTheme.typography.labelSmall)
    }
  }
}

@Composable
private fun FlowLegend() {
  val items = listOf("Present" to Green, "Absent" to Rose, "Leave" to Sky, "WFH/WO" to Amber, "Hold" to InkFaint)
  Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    items.forEach { (l, col) ->
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(9.dp).clip(CircleShape).background(col)); Spacer(Modifier.width(4.dp))
        Text(l, style = MaterialTheme.typography.labelSmall, color = InkSoft)
      }
    }
  }
}
