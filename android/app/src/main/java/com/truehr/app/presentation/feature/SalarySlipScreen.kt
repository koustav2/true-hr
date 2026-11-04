package com.truehr.app.presentation.feature

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.*
import androidx.compose.runtime.*
import com.truehr.app.core.startActivitySafely
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.PayslipRow
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*
import java.io.File

@Composable
fun SalarySlipScreen(onBack: () -> Unit, onOpenDetail: (Long) -> Unit, vm: SalaryViewModel = hiltViewModel()) {
  val context = LocalContext.current
  val s by vm.list.collectAsState()
  val downloading by vm.downloading.collectAsState()
  val downloaded by vm.downloaded.collectAsState()
  val downloadError by vm.downloadError.collectAsState()

  LaunchedEffect(Unit) { vm.load() }
  var yearFilter by remember { mutableStateOf<Int?>(null) }
  var monthFilter by remember { mutableStateOf<Int?>(null) }
  LaunchedEffect(downloadError) { downloadError?.let { Toast.makeText(context, it, Toast.LENGTH_SHORT).show() } }
  LaunchedEffect(downloaded) {
    downloaded?.let { f ->
      try {
        val out = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
          File(File(context.cacheDir, "payslips").apply { mkdirs() }, f.filename).apply { writeBytes(f.bytes) }
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", out)
        context.startActivitySafely(Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, "application/pdf")
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }, "No PDF viewer is installed on this phone. Install one to open payslips.")
      } catch (e: Exception) {
        Toast.makeText(context, "Could not save the payslip on this phone.", Toast.LENGTH_SHORT).show()
      } finally { vm.consumeDownload() }
    }
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Salary Slip", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load() })
      else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
        // E33: year / month filter.
        val all = s.data ?: emptyList()
        val years = all.map { it.year }.distinct().sortedDescending()
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
          FilterDrop("Year", yearFilter?.toString() ?: "All years", listOf<Int?>(null) + years, { it?.toString() ?: "All years" }, Modifier.weight(1f)) { yearFilter = it }
          FilterDrop("Month", monthFilter?.let { MONTH_NAMES[it - 1] } ?: "All months", listOf<Int?>(null) + (1..12).toList(), { it?.let { m -> MONTH_NAMES[m - 1] } ?: "All months" }, Modifier.weight(1f)) { monthFilter = it }
        }
        Spacer(Modifier.height(12.dp))
        Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 2.dp) {
          Column {
            // "Details" title bar
            Box(Modifier.fillMaxWidth().background(Teal).padding(horizontal = 16.dp, vertical = 12.dp)) {
              Text("Details", color = Surface, fontWeight = FontWeight.Bold)
            }
            // Column headers
            Row(Modifier.fillMaxWidth().background(Green.copy(alpha = 0.06f)).padding(vertical = 10.dp)) {
              HCell("View", 0.16f); HCell("Download", 0.20f); HCell("Employee Code", 0.32f); HCell("Year", 0.14f); HCell("Month", 0.18f)
            }
            HorizontalDivider(color = Line)
            val rows = all.filter { (yearFilter == null || it.year == yearFilter) && (monthFilter == null || it.month == monthFilter) }
            if (rows.isEmpty()) {
              Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
                Text(if (all.isEmpty()) "No salary slips published yet." else "No payslips found for this filter.", color = InkSoft)
              }
            } else rows.forEach { row ->
              PayslipRowItem(row, busy = downloading == row.id, onView = { row.id?.let(onOpenDetail) }, onDownload = { vm.download(row) })
              HorizontalDivider(color = Line)
            }
          }
        }
      }
    }
  }
}

@Composable
private fun RowScope.HCell(text: String, weight: Float) {
  Text(text, Modifier.weight(weight), color = Teal, fontWeight = FontWeight.SemiBold,
    style = MaterialTheme.typography.labelMedium, textAlign = TextAlign.Center)
}

@Composable
private fun PayslipRowItem(row: PayslipRow, busy: Boolean, onView: () -> Unit, onDownload: () -> Unit) {
  Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
    // View
    Box(Modifier.weight(0.16f), contentAlignment = Alignment.Center) {
      IconButton(onClick = onView, enabled = row.available && row.id != null) {
        Icon(Icons.Filled.Description, "View", tint = if (row.available) Teal else InkFaint)
      }
    }
    // Download
    Box(Modifier.weight(0.20f), contentAlignment = Alignment.Center) {
      if (busy) CircularProgressIndicator(color = Green, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
      else if (row.available) {
        Box(Modifier.size(34.dp).clip(RoundedCornerShape(8.dp)).background(Sky.copy(alpha = 0.15f)).clickable(onClick = onDownload), contentAlignment = Alignment.Center) {
          Icon(Icons.Filled.Download, "Download", tint = Sky, modifier = Modifier.size(20.dp))
        }
      }
    }
    Text(row.employeeCode ?: "—", Modifier.weight(0.32f), color = Ink, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium)
    Text(row.year.toString(), Modifier.weight(0.14f), color = Ink, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium)
    Text(row.monthName, Modifier.weight(0.18f), color = Ink, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium)
  }
}

private val MONTH_NAMES = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")

@Composable
private fun <T> FilterDrop(label: String, value: String, options: List<T>, text: (T) -> String, modifier: Modifier = Modifier, onPick: (T) -> Unit) {
  var open by remember { mutableStateOf(false) }
  Box(modifier) {
    OutlinedButton(onClick = { open = true }, shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
      Text("$label: $value", color = Ink, style = MaterialTheme.typography.bodyMedium)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      options.forEach { o -> DropdownMenuItem(text = { Text(text(o)) }, onClick = { onPick(o); open = false }) }
    }
  }
}
