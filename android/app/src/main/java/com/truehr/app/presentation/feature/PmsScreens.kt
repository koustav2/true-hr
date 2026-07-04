package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AddCircle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.KraInput
import com.truehr.app.domain.model.PendingRating
import com.truehr.app.domain.model.PmsScoreInput
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.theme.*
import java.util.Calendar

internal val PMS_MONTHS = listOf("January","February","March","April","May","June","July","August","September","October","November","December")

internal fun gradeColor(grade: String?): Color = when (grade) {
  "OAT", "SAT" -> Green
  "AT" -> Color(0xFF65A30D)
  "BT" -> Rose
  "SBT" -> Color(0xFF991B1B)
  else -> InkFaint
}

/* ── My Performance (GreenHR MyKpi.aspx) ─────────────────────────────────── */
@Composable
fun MyPerformanceScreen(onBack: () -> Unit, onCreateKpi: () -> Unit, onOpenKpi: (Long) -> Unit, vm: EssViewModel = hiltViewModel()) {
  val year = remember { Calendar.getInstance().get(Calendar.YEAR) }
  val state by vm.performance.collectAsState()
  LaunchedEffect(Unit) { vm.loadPerformance(year) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
          Text("My Performance", color = Surface, style = MaterialTheme.typography.titleLarge)
        }
        TextButton(onClick = onCreateKpi) { Text("Submit KPI", color = Surface, fontWeight = FontWeight.Bold) }
      }
    }
    when {
      state.loading -> CenterLoader()
      state.error != null -> ErrorState(state.error!!) { vm.loadPerformance(year) }
      state.data.isNullOrEmpty() -> NoTeamState("No KPI submitted yet for $year. Tap Submit KPI to create your first one.")
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(state.data!!) { r ->
          Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.clickable { onOpenKpi(r.id) }.padding(14.dp)) {
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text("${PMS_MONTHS[r.month - 1]} ${r.year}", fontWeight = FontWeight.Bold, color = Ink)
                r.finalGrade?.let {
                  Surface(color = gradeColor(it).copy(alpha = 0.12f), shape = RoundedCornerShape(50)) {
                    Text(it, color = gradeColor(it), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold,
                      modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp))
                  }
                }
              }
              Spacer(Modifier.height(4.dp))
              Text("KPI: ${r.kpiStatus.replace('_', ' ')}  ·  PMS: ${r.pmsStatus.replace('_', ' ')}", color = InkSoft, style = MaterialTheme.typography.bodySmall)
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Self rating: ${r.selfRating ?: "—"}", color = InkFaint, style = MaterialTheme.typography.labelSmall)
                r.finalPliPct?.let { Text("PLI ${it.toInt()}%", color = InkFaint, style = MaterialTheme.typography.labelSmall) }
              }
            }
          }
        }
      }
    }
  }
}

/* ── Create KPI (GreenHR Create_Kpi.aspx) ────────────────────────────────── */
@Composable
fun CreateKpiScreen(onBack: () -> Unit, vm: EssViewModel = hiltViewModel()) {
  val busy by vm.kpiBusy.collectAsState()
  val error by vm.kpiError.collectAsState()
  val done by vm.kpiDone.collectAsState()
  LaunchedEffect(done) { if (done) { vm.consumeKpiDone(); kotlinx.coroutines.delay(500); onBack() } }

  val now = remember { Calendar.getInstance() }
  var monthIdx by remember { mutableStateOf(now.get(Calendar.MONTH)) }
  var year by remember { mutableStateOf(now.get(Calendar.YEAR)) }
  var copyPrevious by remember { mutableStateOf(false) }
  var monthOpen by remember { mutableStateOf(false) }
  val kras = remember { mutableStateListOf(KraInput("", 0.0)) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Create KPI", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      InfoCard {
        @OptIn(ExperimentalMaterial3Api::class)
        ExposedDropdownMenuBox(expanded = monthOpen, onExpandedChange = { monthOpen = it }) {
          OutlinedTextField(value = "${PMS_MONTHS[monthIdx]} $year", onValueChange = {}, readOnly = true, label = { Text("KPI Month") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(monthOpen) }, shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green), modifier = Modifier.menuAnchor().fillMaxWidth())
          ExposedDropdownMenu(expanded = monthOpen, onDismissRequest = { monthOpen = false }) {
            PMS_MONTHS.forEachIndexed { i, m -> DropdownMenuItem(text = { Text(m) }, onClick = { monthIdx = i; monthOpen = false }) }
          }
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
          Checkbox(checked = copyPrevious, onCheckedChange = { copyPrevious = it }, colors = CheckboxDefaults.colors(checkedColor = Green))
          Text("Copy Previous KPI", color = Ink)
        }
      }

      if (!copyPrevious) {
        InfoCard {
          Text("KRAs (weightages must total 100)", fontWeight = FontWeight.Bold, color = Ink)
          Spacer(Modifier.height(8.dp))
          kras.forEachIndexed { i, k ->
            OutlinedTextField(k.description, { kras[i] = k.copy(description = it) }, label = { Text("KRA ${i + 1} description") }, minLines = 2,
              shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green), modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
              AppTextField(if (k.weightage == 0.0) "" else k.weightage.toInt().toString(),
                { v -> kras[i] = k.copy(weightage = v.filter { c -> c.isDigit() }.toDoubleOrNull() ?: 0.0) },
                "Weightage %", modifier = Modifier.weight(1f))
              IconButton(onClick = { if (kras.size > 1) kras.removeAt(i) }) { Icon(Icons.Filled.Delete, null, tint = Rose) }
            }
            Spacer(Modifier.height(10.dp))
          }
          TextButton(onClick = { kras.add(KraInput("", 0.0)) }) {
            Icon(Icons.Filled.AddCircle, null, tint = Green); Spacer(Modifier.width(6.dp)); Text("Add KRA", color = Green)
          }
          Text("Total weightage: ${kras.sumOf { it.weightage }.toInt()}%", color = if (kras.sumOf { it.weightage } == 100.0) Green else Amber, fontWeight = FontWeight.SemiBold)
          Text("Rating bands: 90–104% → 3, 105–119% → 4, 120%+ → 5", color = InkFaint, style = MaterialTheme.typography.labelSmall)
        }
      }

      error?.let { Text(it, color = Rose) }
      if (done) Text("KPI submitted for approval.", color = Green, fontWeight = FontWeight.SemiBold)
      PrimaryButton(if (busy) "" else "Create KPI", loading = busy, onClick = {
        vm.createKpi(year, monthIdx + 1, copyPrevious, kras.toList())
      }, modifier = Modifier.fillMaxWidth())
      Spacer(Modifier.height(8.dp))
    }
  }
}

/* ── KPI detail + Submit PMS (GreenHR CreatePMS/ViewPMS) ─────────────────── */
@Composable
fun KpiDetailScreen(kpiId: Long, onBack: () -> Unit, vm: EssViewModel = hiltViewModel()) {
  val d by vm.kpiDetail.collectAsState()
  val busy by vm.kpiBusy.collectAsState()
  val error by vm.kpiError.collectAsState()
  LaunchedEffect(kpiId) { vm.loadKpiDetail(kpiId) }

  val scores = remember { mutableStateMapOf<Long, PmsScoreInput>() }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text(d.data?.let { "${PMS_MONTHS[it.month - 1]} ${it.year}" } ?: "KPI", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    when {
      d.loading -> { CenterLoader(); return@Column }
      d.error != null -> { ErrorState(d.error!!) { vm.loadKpiDetail(kpiId) }; return@Column }
    }
    val k = d.data ?: return@Column
    val canSubmitPms = k.status == "LOCKED" && k.pms == null

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      InfoCard {
        InfoRow("KPI status", k.status.replace('_', ' '))
        InfoRow("PMS status", k.pms?.status?.replace('_', ' ') ?: "NOT SUBMITTED")
        k.pms?.finalGrade?.let { InfoRow("Final grade", "$it (${k.pms!!.finalPliPct?.toInt() ?: "—"}% PLI)") }
      }

      k.kras.forEach { kra ->
        InfoCard {
          Text("KRA ${kra.seq} — ${kra.weightage.toInt()}%", fontWeight = FontWeight.Bold, color = Ink)
          Spacer(Modifier.height(4.dp))
          Text(kra.description, color = InkSoft, style = MaterialTheme.typography.bodyMedium)
          val existing = k.pms?.scores?.find { it.kraId == kra.id }
          if (existing != null) {
            Spacer(Modifier.height(8.dp))
            InfoRow("MTD target", existing.mtdTarget ?: "—")
            InfoRow("MTD achieved", existing.mtdAchieved ?: "—")
            InfoRow("Self rating", existing.selfRating?.toString() ?: "—")
            existing.mgrRating?.let { InfoRow("Manager rating", "$it — ${existing.mgrRemarks ?: ""}") }
          } else if (canSubmitPms) {
            val s = scores[kra.id] ?: PmsScoreInput(kra.id, null, null, 3.0, null)
            Spacer(Modifier.height(8.dp))
            AppTextField(s.mtdTarget ?: "", { scores[kra.id] = s.copy(mtdTarget = it) }, "MTD Target")
            Spacer(Modifier.height(6.dp))
            AppTextField(s.mtdAchieved ?: "", { scores[kra.id] = s.copy(mtdAchieved = it) }, "MTD Achieved")
            Spacer(Modifier.height(6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
              PickerField(
                "Self rating", listOf(5.0, 4.0, 3.0, 2.0, 1.0), s.selfRating,
                { r -> "${r.toInt()} — ${when (r.toInt()) { 5 -> "OAT"; 4 -> "SAT"; 3 -> "AT"; 2 -> "BT"; else -> "SBT" }}" },
                { r -> scores[kra.id] = s.copy(selfRating = r) },
                modifier = Modifier.weight(1f),
              )
              AppTextField(s.selfRemarks ?: "", { scores[kra.id] = s.copy(selfRemarks = it) }, "Remarks", modifier = Modifier.weight(1f))
            }
          }
        }
      }

      k.pms?.levelRatings?.takeIf { it.isNotEmpty() }?.let { levels ->
        InfoCard {
          Text("Rating Chain", fontWeight = FontWeight.Bold, color = Ink)
          Spacer(Modifier.height(6.dp))
          levels.forEach { l ->
            Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
              Text(l.roleKey.replace('_', ' '), color = InkSoft, style = MaterialTheme.typography.bodySmall)
              Text("PLI ${l.pliPct?.toInt() ?: "—"}% (rating ${l.pliRating ?: "—"}) ${l.ratedBy ?: ""}", color = Ink, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
            }
          }
        }
      }

      error?.let { Text(it, color = Rose) }
      if (canSubmitPms) {
        PrimaryButton(if (busy) "" else "Submit PMS", loading = busy, onClick = {
          val list = k.kras.map { kra -> scores[kra.id] ?: PmsScoreInput(kra.id, null, null, 3.0, null) }
          vm.submitPms(k.id, list)
        }, modifier = Modifier.fillMaxWidth())
      }
      Spacer(Modifier.height(8.dp))
    }
  }
}

/* ── Team KPI approvals + PMS rating queue (manager) ─────────────────────── */
@Composable
fun TeamPmsScreen(onBack: () -> Unit, vm: EssViewModel = hiltViewModel()) {
  val team by vm.teamKpi.collectAsState()
  val queue by vm.ratingQueue.collectAsState()
  val busy by vm.kpiBusy.collectAsState()
  val error by vm.kpiError.collectAsState()
  var rating by remember { mutableStateOf<PendingRating?>(null) }
  LaunchedEffect(Unit) { vm.loadTeamKpi(); vm.loadRatingQueue() }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Team KPI & PMS", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      error?.let { Text(it, color = Rose) }

      SectionTitle("KPI approvals")
      if (team.loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Green)
      else if (team.data.isNullOrEmpty()) Text("No team KPIs pending.", color = InkFaint, style = MaterialTheme.typography.bodySmall)
      else team.data!!.forEach { t ->
        InfoCard {
          Text("${t.employeeName ?: "—"} · ${PMS_MONTHS[t.month - 1]} ${t.year}", fontWeight = FontWeight.Bold, color = Ink)
          t.designation?.let { Text(it, color = InkFaint, style = MaterialTheme.typography.labelSmall) }
          Spacer(Modifier.height(8.dp))
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { vm.reviewKpi(t.id, "APPROVE") }, enabled = !busy, colors = ButtonDefaults.buttonColors(containerColor = Green)) { Text("Approve KPI") }
            OutlinedButton(onClick = { vm.reviewKpi(t.id, "DISCUSS") }, enabled = !busy) { Text("Discuss") }
          }
        }
      }

      SectionTitle("PMS ratings waiting on you")
      if (queue.loading) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Green)
      else if (queue.data.isNullOrEmpty()) Text("No PMS submissions to rate.", color = InkFaint, style = MaterialTheme.typography.bodySmall)
      else queue.data!!.forEach { q ->
        InfoCard {
          Text("${q.employeeName ?: "—"} · ${q.month?.let { PMS_MONTHS[it - 1] } ?: ""} ${q.year ?: ""}", fontWeight = FontWeight.Bold, color = Ink)
          Text("Self rating ${q.selfRating ?: "—"} · your stage: ${q.stageRole?.replace('_', ' ') ?: "—"}", color = InkSoft, style = MaterialTheme.typography.bodySmall)
          Spacer(Modifier.height(8.dp))
          Button(onClick = { rating = q }, enabled = !busy, colors = ButtonDefaults.buttonColors(containerColor = Green)) { Text("Rate") }
        }
      }
      Spacer(Modifier.height(8.dp))
    }
  }

  rating?.let { q ->
    var pliRating by remember { mutableStateOf("3") }
    var pliPct by remember { mutableStateOf("") }
    var remarks by remember { mutableStateOf("") }
    AlertDialog(
      onDismissRequest = { rating = null },
      title = { Text("Rate — ${q.employeeName ?: ""}") },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedTextField(pliRating, { pliRating = it.filter { c -> c.isDigit() }.take(1) }, label = { Text("PLI rating (1–5)") })
          OutlinedTextField(pliPct, { pliPct = it.filter { c -> c.isDigit() } }, label = { Text("PLI %") })
          OutlinedTextField(remarks, { remarks = it }, label = { Text("Remarks") })
        }
      },
      confirmButton = {
        TextButton(onClick = {
          val r = pliRating.toIntOrNull(); val p = pliPct.toDoubleOrNull()
          if (r != null && p != null) { vm.ratePms(q.submissionId, r, p, remarks); rating = null }
        }) { Text("Submit") }
      },
      dismissButton = { TextButton(onClick = { rating = null }) { Text("Cancel") } },
    )
  }
}
