package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.KpiRow
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.InfoCard
import com.truehr.app.presentation.components.SectionTitle
import com.truehr.app.presentation.navigation.Routes
import com.truehr.app.presentation.theme.*
import java.util.Calendar

private data class EssTile(val label: String, val icon: ImageVector, val route: String)

// GreenHR-style employee self-service hub (UserDashboard.aspx): quick tiles +
// the 12-month performance strip.
@Composable
fun EssScreen(onOpen: (String) -> Unit, onBack: () -> Unit, vm: EssViewModel = hiltViewModel()) {
  val year = remember { Calendar.getInstance().get(Calendar.YEAR) }
  val perf by vm.performance.collectAsState()
  LaunchedEffect(Unit) { vm.loadPerformance(year) }

  val tiles = listOf(
    EssTile("My Profile", Icons.Filled.Person, Routes.PROFILE),
    EssTile("Attendance", Icons.Filled.EventAvailable, Routes.ATTENDANCE),
    EssTile("Leave", Icons.Filled.BeachAccess, Routes.LEAVE),
    EssTile("Support", Icons.Filled.SupportAgent, Routes.SUPPORT),
    EssTile("PMS", Icons.Filled.Insights, Routes.MY_PERFORMANCE),
    EssTile("NFA", Icons.Filled.RequestQuote, Routes.NFA),
    EssTile("Salary Slip", Icons.Filled.ReceiptLong, Routes.SALARY),
    EssTile("Policies", Icons.AutoMirrored.Filled.ListAlt, Routes.POLICIES),
    EssTile("HR Induction", Icons.Filled.School, Routes.feature("HR Induction")),
    EssTile("Feedback", Icons.Filled.Forum, Routes.feature("Feedback")),
    EssTile("COC / Undertaking", Icons.Filled.Gavel, Routes.feature("Business COC / Undertaking")),
    EssTile("E-Resignation", Icons.Filled.Logout, Routes.RESIGNATION),
  )

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("My ESS", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {

      // Monthly Performance strip (GreenHR: Good & Consistent / Average / Below Average / Not Available / Pending)
      InfoCard {
        Text("Monthly Performance — $year", fontWeight = FontWeight.Bold, color = Ink)
        Spacer(Modifier.height(8.dp))
        if (perf.loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Green)
        else {
          val byMonth = (perf.data ?: emptyList()).associateBy { it.month }
          LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            items((1..12).toList()) { m -> MonthChip(m, byMonth[m]) }
          }
          Spacer(Modifier.height(8.dp))
          Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            LegendDot(Green, "Good"); LegendDot(Color(0xFF65A30D), "Average"); LegendDot(Rose, "Below"); LegendDot(Amber, "Pending"); LegendDot(InkFaint, "N/A")
          }
        }
      }

      SectionTitle("Self Service")
      // 3-column tile grid (fixed rows inside the scroll column)
      tiles.chunked(3).forEach { row ->
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          row.forEach { t ->
            Surface(color = Surface, shape = RoundedCornerShape(18.dp), shadowElevation = 2.dp, modifier = Modifier.weight(1f).height(112.dp)) {
              Column(Modifier.clickable { onOpen(t.route) }.padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Box(Modifier.size(44.dp).clip(CircleShape).background(Green.copy(alpha = 0.10f)), contentAlignment = Alignment.Center) {
                  Icon(t.icon, null, tint = Green, modifier = Modifier.size(22.dp))
                }
                Spacer(Modifier.height(8.dp))
                Text(t.label, style = MaterialTheme.typography.labelSmall, color = Ink, textAlign = TextAlign.Center, maxLines = 2)
              }
            }
          }
          repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
        }
      }
      Spacer(Modifier.height(8.dp))
    }
  }
}

@Composable
private fun MonthChip(month: Int, row: KpiRow?) {
  val (color, label) = when {
    row == null -> InkFaint to "Not Available"
    row.pmsStatus == "FUNCTIONAL_APPROVED" -> gradeColor(row.finalGrade) to (row.finalGrade ?: "Rated")
    row.pmsStatus == "APPROVAL_PENDING" -> Amber to "Pending-RPT"
    row.kpiStatus == "RM_PENDING" -> Amber to "Pending-RPT"
    else -> Amber to "Pending"
  }
  Surface(color = color.copy(alpha = 0.10f), shape = RoundedCornerShape(12.dp)) {
    Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Text(PMS_MONTHS[month - 1].take(3), color = Ink, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
      Text(label, color = color, style = MaterialTheme.typography.labelSmall)
    }
  }
}

@Composable
private fun LegendDot(color: Color, label: String) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Box(Modifier.size(8.dp).clip(CircleShape).background(color))
    Spacer(Modifier.width(4.dp))
    Text(label, color = InkFaint, style = MaterialTheme.typography.labelSmall)
  }
}
