package com.truehr.app.presentation.feature

import android.util.Base64
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.InfoCard
import com.truehr.app.presentation.components.InfoRow
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.PrimaryButton
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateTicketScreen(category: String, onBack: () -> Unit, vm: SupportViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val ctx = LocalContext.current
  val p by profileVm.state.collectAsState()
  val catalog by vm.catalog.collectAsState()
  val submitting by vm.submitting.collectAsState()
  val submitError by vm.submitError.collectAsState()
  val submitted by vm.submitted.collectAsState()

  val cfg = catalog[category]
  val title = when (category) { "HR" -> "HR Support"; "IT" -> "IT Support"; else -> "Admin Support" }

  var issueType by remember { mutableStateOf("") }
  var issueDetail by remember { mutableStateOf("") }
  var typeOpen by remember { mutableStateOf(false) }
  var detailOpen by remember { mutableStateOf(false) }
  var desc by remember { mutableStateOf("") }
  var attachment by remember { mutableStateOf<String?>(null) }
  var attachMime by remember { mutableStateOf<String?>(null) }
  var attachInfo by remember { mutableStateOf<String?>(null) }

  val details = cfg?.details?.get(issueType) ?: emptyList()

  LaunchedEffect(Unit) { vm.loadCatalog() }
  LaunchedEffect(issueType) { issueDetail = "" }
  LaunchedEffect(submitted) { if (submitted) { Toast.makeText(ctx, "Request submitted", Toast.LENGTH_SHORT).show(); onBack() } }

  val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
    if (uri != null) {
      val bytes = runCatching { ctx.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
      when {
        bytes == null -> attachInfo = "Could not read file"
        bytes.size > 5 * 1024 * 1024 -> attachInfo = "File too large (max 5MB)"
        else -> { attachment = Base64.encodeToString(bytes, Base64.NO_WRAP); attachMime = ctx.contentResolver.getType(uri) ?: "application/octet-stream"; attachInfo = "Attached (${bytes.size / 1024} KB)" }
      }
    }
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
          IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
          Text(title, color = Surface, style = MaterialTheme.typography.titleLarge)
        }
        Spacer(Modifier.height(8.dp))
        Text("Employee Information", color = Surface, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      InfoCard {
        InfoRow("Emp Code", p.data?.employeeCode)
        InfoRow("Name", p.data?.fullName)
        InfoRow("Email", p.data?.officialEmail)
        InfoRow("Mobile", p.data?.phone)
      }

      Text("Issue Details", fontWeight = FontWeight.Black, color = Ink, style = MaterialTheme.typography.titleLarge)

      ExposedDropdownMenuBox(expanded = typeOpen, onExpandedChange = { typeOpen = it }) {
        OutlinedTextField(value = issueType, onValueChange = {}, readOnly = true, label = { Text("Issue Type") },
          placeholder = { Text("Select an issue type") },
          trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(typeOpen) },
          shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
          modifier = Modifier.menuAnchor().fillMaxWidth())
        ExposedDropdownMenu(expanded = typeOpen, onDismissRequest = { typeOpen = false }) {
          (cfg?.types ?: emptyList()).forEach { t -> DropdownMenuItem(text = { Text(t) }, onClick = { issueType = t; typeOpen = false }) }
        }
      }

      if (details.isNotEmpty()) {
        ExposedDropdownMenuBox(expanded = detailOpen, onExpandedChange = { detailOpen = it }) {
          OutlinedTextField(value = issueDetail, onValueChange = {}, readOnly = true, label = { Text("Issue Detail") },
            placeholder = { Text("Select a detail") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(detailOpen) },
            shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
            modifier = Modifier.menuAnchor().fillMaxWidth())
          ExposedDropdownMenu(expanded = detailOpen, onDismissRequest = { detailOpen = false }) {
            details.forEach { d -> DropdownMenuItem(text = { Text(d) }, onClick = { issueDetail = d; detailOpen = false }) }
          }
        }
      }

      OutlinedTextField(desc, { desc = it }, label = { Text("Issue Description") }, minLines = 4,
        shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green), modifier = Modifier.fillMaxWidth())

      if (cfg?.attachment == true) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
          Text(attachInfo ?: "Attach Document (Optional)", color = if (attachment != null) Green else Ink, fontWeight = FontWeight.SemiBold)
          TextButton(onClick = { fileLauncher.launch("*/*") }) {
            Icon(Icons.Filled.AttachFile, null, tint = Green, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text(if (attachment == null) "Browse" else "Replace", color = Green)
          }
        }
      }

      submitError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      PrimaryButton(if (submitting) "" else "Submit Request", loading = submitting, onClick = {
        if (issueType.isBlank()) Toast.makeText(ctx, "Select an issue type", Toast.LENGTH_SHORT).show()
        else if (details.isNotEmpty() && issueDetail.isBlank()) Toast.makeText(ctx, "Select an issue detail", Toast.LENGTH_SHORT).show()
        else vm.submit(category, issueType, issueDetail.ifBlank { null }, desc, attachment, attachMime)
      }, modifier = Modifier.fillMaxWidth())
      Spacer(Modifier.height(8.dp))
    }
  }
}
