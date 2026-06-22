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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.PayLine
import com.truehr.app.domain.model.Payslip
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*
import java.text.NumberFormat
import java.util.Locale

private val INR = NumberFormat.getNumberInstance(Locale("en", "IN")).apply { minimumFractionDigits = 2; maximumFractionDigits = 2 }
private fun money(n: Double) = "₹ ${INR.format(n)}"

@Composable
fun PayslipDetailScreen(payslipId: Long, onBack: () -> Unit, vm: SalaryViewModel = hiltViewModel()) {
  val s by vm.detail.collectAsState()
  LaunchedEffect(payslipId) { vm.loadDetail(payslipId) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Pay Slip", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.loadDetail(payslipId) })
      s.data != null -> PayslipBody(s.data!!)
    }
  }
}

@Composable
private fun PayslipBody(p: Payslip) {
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
    Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
      Column(Modifier.padding(16.dp)) {
        Text("PAY SLIP — ${p.monthName.uppercase()} ${p.year}", fontWeight = FontWeight.Bold, color = Green)
        Text("Days paid: ${fmtDays(p.daysPaid)} / ${p.daysInMonth}", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
      }
    }

    p.meta?.let { m ->
      Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
        Column(Modifier.padding(16.dp)) {
          Text("Employee Details", color = Teal, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
          Spacer(Modifier.height(8.dp))
          KV("Emp Name", m.name); KV("Emp No.", m.employeeCode); KV("Designation", m.designation); KV("Grade", m.grade)
          KV("UAN", m.uan); KV("PAN", m.pan); KV("Bank", m.bankName); KV("A/C No.", m.accountNumber)
          KV("Location", m.location); KV("State", m.state)
        }
      }
    }

    Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
      Column(Modifier.padding(16.dp)) {
        SectionHead("Earnings", "Amount")
        p.earnings.forEach { LineRow(it) }
        if (p.arrears > 0) LineRow(PayLine("Arrears", p.arrears))
        TotalRow("Total Earnings", p.grossEarnings)
      }
    }

    Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp) {
      Column(Modifier.padding(16.dp)) {
        SectionHead("Deductions", "Amount")
        p.deductions.forEach { LineRow(it) }
        TotalRow("Total Deductions", p.totalDeductions)
      }
    }

    Surface(color = Green, shape = RoundedCornerShape(14.dp)) {
      Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("NET PAY", color = Surface, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        Text(money(p.netPay), color = Surface, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
      }
    }
    Text("* Computer-generated payslip; no signature required.", color = InkFaint, style = MaterialTheme.typography.labelSmall)
  }
}

@Composable private fun SectionHead(left: String, right: String) {
  Row(Modifier.fillMaxWidth()) {
    Text(left, color = Teal, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
    Text(right, color = Teal, fontWeight = FontWeight.Bold)
  }
  HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 8.dp))
}

@Composable private fun LineRow(l: PayLine) {
  Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
    Text(l.label, color = Ink, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
    Text(money(l.amount), color = Ink, style = MaterialTheme.typography.bodyMedium)
  }
}

@Composable private fun TotalRow(label: String, amount: Double) {
  HorizontalDivider(color = Line, modifier = Modifier.padding(vertical = 8.dp))
  Row(Modifier.fillMaxWidth()) {
    Text(label, color = Ink, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
    Text(money(amount), color = Ink, fontWeight = FontWeight.Bold)
  }
}

@Composable private fun KV(k: String, v: String?) {
  Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
    Text(k, color = InkFaint, modifier = Modifier.width(110.dp), style = MaterialTheme.typography.bodyMedium)
    Text(v?.ifBlank { "—" } ?: "—", color = Ink, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
  }
}

private fun fmtDays(d: Double) = if (d == d.toLong().toDouble()) d.toLong().toString() else d.toString()
