package com.truehr.app.presentation.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.core.Dates
import com.truehr.app.core.Labels
import com.truehr.app.data.remote.dto.AddressDto
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.theme.*

/** E53: the full record, read-only; bank / PAN / Aadhaar come masked from the server. */
@Composable
fun ProfileScreen(onBack: () -> Unit, onRequestChange: () -> Unit = {}, vm: ChangeRequestViewModel = hiltViewModel()) {
  val s by vm.profile.collectAsState()
  Box(Modifier.fillMaxSize().background(Canvas)) {
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load() })
      s.data != null -> {
        val p = s.data!!
        val name = p.fullName ?: listOfNotNull(p.firstName, p.lastName).joinToString(" ")
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
          GradientHeader {
            Column {
              Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
                Text("My Profile", color = Surface, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
              }
              Spacer(Modifier.height(8.dp))
              Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(name, 52)
                Spacer(Modifier.width(12.dp))
                Column {
                  Text(name, color = Surface, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                  Text(p.designation ?: "", color = Surface.copy(alpha = 0.85f))
                }
              }
            }
          }
          Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            OutlinedButton(onClick = onRequestChange, modifier = Modifier.fillMaxWidth()) { Text("Request a change") }
            SectionTitle("Employment")
            InfoCard {
              InfoRow("Employee Code", p.employeeCode)
              InfoRow("Company", p.company)
              InfoRow("Department", listOfNotNull(p.department, p.subDepartment).joinToString(" / "))
              InfoRow("Designation", p.designation)
              InfoRow("Employment Type", p.employmentType?.let { Labels.of(it) })
              InfoRow("Date of Joining", p.dateOfJoining?.let { Dates.dmy(it) })
              InfoRow("Office Location", p.branch ?: p.location)
              InfoRow("Reporting Manager", listOfNotNull(p.reportingManagerCode, p.reportingManager).joinToString(" - "))
              InfoRow("Functional Manager", p.functionalManager)
              if (!p.operationalManager.isNullOrBlank()) InfoRow("Operational Manager", p.operationalManager)
            }
            SectionTitle("Personal")
            InfoCard {
              InfoRow("Date of Birth", p.dob?.let { Dates.dmy(it) })
              InfoRow("Gender", p.gender?.let { Labels.of(it) })
              InfoRow("Blood Group", p.bloodGroup)
              InfoRow("Marital Status", p.maritalStatus?.let { Labels.of(it) })
              InfoRow("Phone", p.phone)
              InfoRow("Personal Email", p.personalEmail)
              InfoRow("Official Email", p.officialEmail)
            }
            SectionTitle("Addresses")
            InfoCard {
              InfoRow("Current Address", p.addresses.firstOrNull { it.type == "CURRENT" }?.oneLine())
              InfoRow("Permanent Address", p.addresses.firstOrNull { it.type == "PERMANENT" }?.oneLine())
            }
            SectionTitle("Bank (masked)")
            InfoCard {
              InfoRow("Account Holder", p.bank.accountHolder)
              InfoRow("Bank Name", p.bank.bankName)
              InfoRow("Branch", p.bank.branch)
              InfoRow("IFSC Code", p.bank.ifsc)
              InfoRow("Account Number", p.bank.accountNumberMasked)
            }
            SectionTitle("Statutory (masked)")
            InfoCard {
              InfoRow("PAN", p.statutory.panMasked)
              InfoRow("Aadhaar", p.statutory.aadhaarMasked)
              InfoRow("UAN", p.statutory.uan)
              InfoRow("PF Number", p.statutory.pfNumber)
              InfoRow("ESI Number", p.statutory.esiNumber)
            }
            Text("Documents can be uploaded for HR verification from My ESS (web).", color = InkFaint, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(8.dp))
          }
        }
      }
    }
  }
}

private fun AddressDto.oneLine(): String =
  listOfNotNull(line1, line2, city, district, state, pincode, country).filter { it.isNotBlank() }.joinToString(", ")
