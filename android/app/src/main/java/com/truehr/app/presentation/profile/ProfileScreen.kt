package com.truehr.app.presentation.profile

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.theme.*

@Composable
fun ProfileScreen(onBack: () -> Unit, vm: ProfileViewModel = hiltViewModel()) {
  val s by vm.state.collectAsState()
  Box(Modifier.fillMaxSize().background(Canvas)) {
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = vm::load)
      s.data != null -> {
        val p = s.data!!
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
          GradientHeader {
            Column {
              Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
                Text("My Profile", color = Surface, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
              }
              Spacer(Modifier.height(8.dp))
              Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(p.fullName, 52)
                Spacer(Modifier.width(12.dp))
                Column {
                  Text(p.fullName, color = Surface, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                  Text(p.designation, color = Surface.copy(alpha = 0.85f))
                }
              }
            }
          }
          Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            InfoCard {
              Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                InfoRow("Employee Code", p.employeeCode)
                InfoRow("Department", p.department)
              }
            }
            SectionTitle("Personal Details")
            InfoCard {
              InfoRow("Date of Birth", p.dob)
              InfoRow("Contact Number", p.phone)
              InfoRow("Email", p.personalEmail)
              InfoRow("Address", p.address)
            }
            SectionTitle("Official Details")
            InfoCard {
              InfoRow("Date of Joining", p.dateOfJoining)
              InfoRow("Official Email", p.officialEmail)
              InfoRow("Reporting Manager", p.reportingManager)
              InfoRow("Functional Manager", p.functionalManager)
              InfoRow("Location", p.location)
            }
            SectionTitle("Bank Details")
            InfoCard {
              InfoRow("Bank Name", p.bankName)
              InfoRow("Account Number", p.accountNumber)
              InfoRow("IFSC Code", p.ifsc)
            }
            Spacer(Modifier.height(8.dp))
          }
        }
      }
    }
  }
}
