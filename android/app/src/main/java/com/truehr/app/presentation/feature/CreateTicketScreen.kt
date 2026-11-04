package com.truehr.app.presentation.feature

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
import com.truehr.app.core.launchSafely
import com.truehr.app.presentation.components.FieldError
import kotlinx.coroutines.launch
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
  val errors by vm.fieldErrors.collectAsState()
  val catalogError by vm.catalogError.collectAsState()
  val scope = rememberCoroutineScope()

  val cfg = catalog[category]
  val title = when (category) { "HR" -> "HR Support"; "IT" -> "IT Support"; else -> "Admin Support" }

  var issueType by remember { mutableStateOf("") }
  var issueDetail by remember { mutableStateOf("") }
  var typeOpen by remember { mutableStateOf(false) }
  var detailOpen by remember { mutableStateOf(false) }
  var subject by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf("") }
  var desc by androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf("") }
  var attachment by remember { mutableStateOf<String?>(null) }
  var attachMime by remember { mutableStateOf<String?>(null) }
  var attachName by remember { mutableStateOf<String?>(null) }
  var attachInfo by remember { mutableStateOf<String?>(null) }

  val details = cfg?.details?.get(issueType) ?: emptyList()

  LaunchedEffect(Unit) { vm.loadCatalog() }
  LaunchedEffect(issueType) { issueDetail = "" }
  LaunchedEffect(submitted) {
    submitted?.let { no -> Toast.makeText(ctx, if (no > 0) "Ticket #$no created" else "Request submitted", Toast.LENGTH_LONG).show(); onBack() }
  }

  val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
    if (uri != null) scope.launch {
      com.truehr.app.core.readPickedFile(ctx, uri).onSuccess { f ->
        attachment = f.base64; attachMime = f.mime; attachName = f.name; attachInfo = "${f.name} (${f.sizeKb} KB)"
      }.onFailure { attachInfo = it.message }
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
      catalogError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }

      ExposedDropdownMenuBox(expanded = typeOpen, onExpandedChange = { typeOpen = it }) {
        OutlinedTextField(value = issueType, onValueChange = {}, readOnly = true, label = { Text("Issue Type *") }, isError = errors["issueType"] != null,
          placeholder = { Text("Select an issue type") },
          trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(typeOpen) },
          shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
          modifier = Modifier.menuAnchor().fillMaxWidth())
        ExposedDropdownMenu(expanded = typeOpen, onDismissRequest = { typeOpen = false }) {
          (cfg?.types ?: emptyList()).forEach { t -> DropdownMenuItem(text = { Text(t) }, onClick = { issueType = t; typeOpen = false; vm.clearFieldError("issueType") }) }
        }
      }
      FieldError(errors["issueType"])

      if (details.isNotEmpty()) {
        ExposedDropdownMenuBox(expanded = detailOpen, onExpandedChange = { detailOpen = it }) {
          OutlinedTextField(value = issueDetail, onValueChange = {}, readOnly = true, label = { Text("Issue Detail *") }, isError = errors["issueDetail"] != null,
            placeholder = { Text("Select a detail") },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(detailOpen) },
            shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
            modifier = Modifier.menuAnchor().fillMaxWidth())
          ExposedDropdownMenu(expanded = detailOpen, onDismissRequest = { detailOpen = false }) {
            details.forEach { d -> DropdownMenuItem(text = { Text(d) }, onClick = { issueDetail = d; detailOpen = false; vm.clearFieldError("issueDetail") }) }
          }
        }
        FieldError(errors["issueDetail"])
      }

      OutlinedTextField(subject, { subject = it.take(120); vm.clearFieldError("subject") }, label = { Text("Subject *") }, singleLine = true,
        isError = errors["subject"] != null,
        shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green), modifier = Modifier.fillMaxWidth())
      FieldError(errors["subject"])

      // E42: limited to 2000 characters with a live counter.
      OutlinedTextField(desc, { desc = it.take(com.truehr.app.core.Validators.SUPPORT_DESC_MAX); vm.clearFieldError("description") },
        label = { Text("Issue Description *") }, minLines = 4, isError = errors["description"] != null,
        supportingText = { Text("${desc.length}/${com.truehr.app.core.Validators.SUPPORT_DESC_MAX} · at least 10 characters") },
        shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green), modifier = Modifier.fillMaxWidth())
      FieldError(errors["description"])

      if (cfg?.attachment == true) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
          Text(attachInfo ?: "Attach Document (Optional)", color = if (attachment != null) Green else Ink, fontWeight = FontWeight.SemiBold)
          TextButton(onClick = { fileLauncher.launchSafely(ctx, "*/*", "No file picker is available on this phone.") }) {
            Icon(Icons.Filled.AttachFile, null, tint = Green, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text(if (attachment == null) "Browse" else "Replace", color = Green)
          }
        }
      }

      submitError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      FieldError(errors["attachment"])
      PrimaryButton(if (submitting) "" else "Submit Request", loading = submitting, onClick = {
        vm.submit(category, subject, issueType, issueDetail, desc, attachment, attachMime, attachName)
      }, modifier = Modifier.fillMaxWidth())
      Spacer(Modifier.height(8.dp))
    }
  }
}
