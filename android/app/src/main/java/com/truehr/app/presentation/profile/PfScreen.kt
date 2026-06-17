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
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.theme.*

@Composable
fun PfScreen(onBack: () -> Unit, vm: ProfileViewModel = hiltViewModel()) {
  val s by vm.state.collectAsState()
  Box(Modifier.fillMaxSize().background(Canvas)) {
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = vm::load)
      s.data != null -> {
        val p = s.data!!
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
          GradientHeader {
            Row(verticalAlignment = Alignment.CenterVertically) {
              IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
              Text("PF & Insurance Details", color = Surface, style = MaterialTheme.typography.titleLarge)
            }
          }
          Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            PfRow("Employee Code", p.employeeCode)
            PfRow("Mobile", p.phone)
            PfRow("Email", p.officialEmail)
            PfRow("Company", p.company)
            PfRow("Aadhaar", p.aadhaar)
            PfRow("PAN", p.pan)
            PfRow("UAN No.", p.uan)
            PfRow("PF Number", p.pfNumber)
            PfRow("ESIC Number", p.esiNumber ?: "Exempted")
            Spacer(Modifier.height(8.dp))
          }
        }
      }
    }
  }
}

@Composable
private fun PfRow(label: String, value: String?) {
  Surface(color = Surface.copy(alpha = 0.7f), shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
    Column(Modifier.padding(16.dp)) {
      Text(label + ":", color = Pink, style = MaterialTheme.typography.labelLarge)
      Spacer(Modifier.height(4.dp))
      Text(value?.ifBlank { "—" } ?: "—", color = Ink, style = MaterialTheme.typography.bodyLarge)
    }
  }
}
