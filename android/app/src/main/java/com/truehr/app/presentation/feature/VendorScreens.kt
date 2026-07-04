package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import com.truehr.app.domain.model.AgreementInput
import com.truehr.app.domain.model.NfaClientVendor
import com.truehr.app.domain.model.NfaLocation
import com.truehr.app.domain.model.NfaProject
import com.truehr.app.domain.model.VendorInput
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.theme.*

private fun regStatusColor(s: String): Color = when (s) {
  "APPROVED" -> Green
  "REJECTED" -> Rose
  else -> Amber
}

/* ── Vendor Registration (GreenHR NFA → Vendor Registration) ─────────────── */
@Composable
fun VendorRegistrationScreen(onBack: () -> Unit, vm: EssViewModel = hiltViewModel()) {
  val list by vm.vendors.collectAsState()
  val busy by vm.formBusy.collectAsState()
  val error by vm.formError.collectAsState()
  val done by vm.formDone.collectAsState()
  LaunchedEffect(Unit) { vm.loadVendors() }
  LaunchedEffect(done) { if (done) vm.consumeFormDone() }

  var companyName by remember { mutableStateOf("") }
  var nature by remember { mutableStateOf("") }
  var type by remember { mutableStateOf("") }
  var pan by remember { mutableStateOf("") }
  var gst by remember { mutableStateOf("") }
  var esic by remember { mutableStateOf("") }
  var pf by remember { mutableStateOf("") }
  var msmed by remember { mutableStateOf("") }
  var nsic by remember { mutableStateOf("") }
  var contactPerson by remember { mutableStateOf("") }
  var contactPhone by remember { mutableStateOf("") }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Vendor Registration", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      InfoCard {
        Text("Register Vendor", fontWeight = FontWeight.Bold, color = Ink)
        Spacer(Modifier.height(10.dp))
        AppTextField(companyName, { companyName = it }, "Company name *")
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          AppTextField(nature, { nature = it }, "Nature of business", modifier = Modifier.weight(1f))
          AppTextField(type, { type = it }, "Type of company", modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          AppTextField(pan, { pan = it }, "PAN", modifier = Modifier.weight(1f))
          AppTextField(gst, { gst = it }, "GST", modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          AppTextField(esic, { esic = it }, "ESIC", modifier = Modifier.weight(1f))
          AppTextField(pf, { pf = it }, "PF", modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          AppTextField(msmed, { msmed = it }, "MSMED", modifier = Modifier.weight(1f))
          AppTextField(nsic, { nsic = it }, "NSIC / SSI", modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          AppTextField(contactPerson, { contactPerson = it }, "Contact person", modifier = Modifier.weight(1f))
          AppTextField(contactPhone, { contactPhone = it }, "Contact phone", modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(12.dp))
        error?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodySmall); Spacer(Modifier.height(6.dp)) }
        PrimaryButton(if (busy) "" else "Register Vendor", loading = busy, onClick = {
          vm.createVendor(VendorInput(
            companyName = companyName.trim(), natureOfBusiness = nature.ifBlank { null }, typeOfCompany = type.ifBlank { null },
            pan = pan.ifBlank { null }, gst = gst.ifBlank { null }, esic = esic.ifBlank { null }, pf = pf.ifBlank { null },
            msmed = msmed.ifBlank { null }, nsicSsi = nsic.ifBlank { null },
            contactPerson = contactPerson.ifBlank { null }, contactPhone = contactPhone.ifBlank { null },
          ))
          companyName = ""
        }, modifier = Modifier.fillMaxWidth())
      }

      SectionTitle("My Registrations")
      if (list.loading) CenterLoader()
      else if (list.data.isNullOrEmpty()) Text("No vendors registered yet.", color = InkFaint, style = MaterialTheme.typography.bodySmall)
      else list.data!!.forEach { v ->
        InfoCard {
          Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(v.companyName, fontWeight = FontWeight.Bold, color = Ink)
            Surface(color = regStatusColor(v.status).copy(alpha = 0.12f), shape = RoundedCornerShape(50)) {
              Text(v.status, color = regStatusColor(v.status), style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp))
            }
          }
          Text(listOfNotNull(v.natureOfBusiness, v.typeOfCompany, v.pan?.let { "PAN $it" }, v.gst?.let { "GST $it" }).joinToString(" · "),
            color = InkSoft, style = MaterialTheme.typography.bodySmall)
        }
      }
      Spacer(Modifier.height(8.dp))
    }
  }
}

/* ── Upload Agreement (GreenHR NFA → Upload Rent Agreement) ──────────────── */
@Composable
fun UploadAgreementScreen(onBack: () -> Unit, vm: EssViewModel = hiltViewModel(), nfaVm: NfaViewModel = hiltViewModel()) {
  val masters by nfaVm.masters.collectAsState()
  val list by vm.agreements.collectAsState()
  val busy by vm.formBusy.collectAsState()
  val error by vm.formError.collectAsState()
  val done by vm.formDone.collectAsState()
  LaunchedEffect(Unit) { nfaVm.loadMasters(); vm.loadAgreements() }
  LaunchedEffect(done) { if (done) vm.consumeFormDone() }

  var project by remember { mutableStateOf<NfaProject?>(null) }
  var location by remember { mutableStateOf<NfaLocation?>(null) }
  var client by remember { mutableStateOf<NfaClientVendor?>(null) }
  var type by remember { mutableStateOf("RENT") }
  var details by remember { mutableStateOf("") }
  var startDate by remember { mutableStateOf("") }
  var endDate by remember { mutableStateOf("") }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Upload Agreement", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      InfoCard {
        Text("Agreement Details", fontWeight = FontWeight.Bold, color = Ink)
        Spacer(Modifier.height(10.dp))
        PickerField("Select Project", masters.data?.projects ?: emptyList(), project, { it.name }, { project = it })
        Spacer(Modifier.height(8.dp))
        PickerField("Location", masters.data?.locations ?: emptyList(), location, { it.name }, { location = it })
        Spacer(Modifier.height(8.dp))
        PickerField("Client", masters.data?.clientsVendors ?: emptyList(), client, { it.name }, { client = it })
        Spacer(Modifier.height(8.dp))
        PickerField("Agreement Type", listOf("RENT", "SERVICE", "MOU", "OTHER"), type, { it }, { type = it })
        Spacer(Modifier.height(8.dp))
        AppTextField(details, { details = it }, "Agreement details")
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          DatePickField("Start date", startDate, { startDate = it }, modifier = Modifier.weight(1f))
          DatePickField("End date", endDate, { endDate = it }, modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(12.dp))
        error?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodySmall); Spacer(Modifier.height(6.dp)) }
        PrimaryButton(if (busy) "" else "Submit Agreement", loading = busy, onClick = {
          vm.createAgreement(AgreementInput(
            projectId = project?.id, locationId = location?.id, clientId = client?.id,
            agreementType = type, details = details.ifBlank { null }, startDate = startDate.trim(), endDate = endDate.trim(),
          ))
        }, modifier = Modifier.fillMaxWidth())
      }

      SectionTitle("My Agreements")
      if (list.loading) CenterLoader()
      else if (list.data.isNullOrEmpty()) Text("No agreements uploaded yet.", color = InkFaint, style = MaterialTheme.typography.bodySmall)
      else list.data!!.forEach { a ->
        InfoCard {
          Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("${a.agreementType} — ${a.projectName ?: "—"}", fontWeight = FontWeight.Bold, color = Ink)
            Surface(color = regStatusColor(a.status).copy(alpha = 0.12f), shape = RoundedCornerShape(50)) {
              Text(a.status, color = regStatusColor(a.status), style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp))
            }
          }
          Text(listOfNotNull(a.locationName, a.clientName, a.startDate?.let { "$it → ${a.endDate ?: ""}" }).joinToString(" · "),
            color = InkSoft, style = MaterialTheme.typography.bodySmall)
        }
      }
      Spacer(Modifier.height(8.dp))
    }
  }
}
