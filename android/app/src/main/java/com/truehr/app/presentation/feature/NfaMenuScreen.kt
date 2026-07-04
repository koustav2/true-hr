package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.FactCheck
import androidx.compose.material.icons.filled.PostAdd
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.InfoCard
import com.truehr.app.presentation.navigation.Routes
import com.truehr.app.presentation.theme.*

private data class NfaTile(val label: String, val icon: ImageVector, val route: String)

@Composable
fun NfaMenuScreen(onOpen: (String) -> Unit, onBack: () -> Unit, vm: NfaViewModel = hiltViewModel()) {
  val ledger by vm.ledger.collectAsState()
  LaunchedEffect(Unit) { vm.loadLedger() }

  val tiles = listOf(
    NfaTile("Create NFA", Icons.Filled.PostAdd, Routes.NFA_CREATE),
    NfaTile("My NFAs", Icons.AutoMirrored.Filled.ListAlt, Routes.NFA_LIST),
    NfaTile("NFA Approvals", Icons.Filled.FactCheck, Routes.NFA_APPROVALS),
    NfaTile("Update Settlement", Icons.Filled.AccountBalanceWallet, Routes.NFA_LIST),
    NfaTile("Settlement Approvals", Icons.Filled.FactCheck, Routes.SETTLEMENT_APPROVALS),
    NfaTile("Vendor Registration", Icons.Filled.PostAdd, Routes.VENDOR_REGISTRATION),
    NfaTile("Upload Agreement", Icons.AutoMirrored.Filled.ListAlt, Routes.UPLOAD_AGREEMENT),
  )

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("NFA — Note For Approval", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
      tiles.chunked(2).forEach { row ->
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
          row.forEach { t ->
            Surface(color = Surface, shape = RoundedCornerShape(18.dp), shadowElevation = 2.dp, modifier = Modifier.weight(1f).height(120.dp)) {
              Column(Modifier.clickable { onOpen(t.route) }.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Box(Modifier.size(46.dp).clip(CircleShape).background(Green.copy(alpha = 0.10f)), contentAlignment = Alignment.Center) {
                  Icon(t.icon, null, tint = Green, modifier = Modifier.size(22.dp))
                }
                Spacer(Modifier.height(10.dp))
                Text(t.label, style = MaterialTheme.typography.labelMedium, color = Ink, textAlign = TextAlign.Center)
              }
            }
          }
          repeat(2 - row.size) { Spacer(Modifier.weight(1f)) }
        }
      }
      InfoCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Box(Modifier.size(34.dp).clip(CircleShape).background(Green.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.AccountBalanceWallet, null, tint = Green, modifier = Modifier.size(18.dp))
          }
          Spacer(Modifier.width(10.dp))
          Text("My NFA Ledger", fontWeight = FontWeight.Bold, color = Ink)
        }
        Spacer(Modifier.height(10.dp))
        when {
          ledger.loading -> LinearProgressIndicator(Modifier.fillMaxWidth(), color = Green)
          ledger.error != null -> Text(ledger.error!!, color = Rose, style = MaterialTheme.typography.bodyMedium)
          ledger.data != null -> {
            val l = ledger.data!!
            Text("Financial Year ${l.financialYear}", color = InkFaint, style = MaterialTheme.typography.labelMedium)
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
              LedgerStat("Raised", l.totalRaised.toInt().toString())
              LedgerStat("Released", l.paymentsReleased.toInt().toString())
              LedgerStat("Settled", l.settled.toInt().toString())
            }
            Spacer(Modifier.height(10.dp))
            HorizontalDivider(color = Line)
            Spacer(Modifier.height(10.dp))
            LedgerAmountRow("Amount received", l.amountReceived)
            LedgerAmountRow("Settlement amount", l.settlementAmount)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
              Text("Balance to settle", color = if (l.balanceToSettle > 0) Rose else InkSoft, fontWeight = FontWeight.SemiBold)
              Text("₹${"%,.0f".format(l.balanceToSettle)}", color = if (l.balanceToSettle > 0) Rose else Green, fontWeight = FontWeight.Bold)
            }
          }
        }
      }
    }
  }
}

@Composable
private fun LedgerStat(label: String, value: String) {
  Column(horizontalAlignment = Alignment.CenterHorizontally) {
    Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = Ink)
    Text(label, style = MaterialTheme.typography.labelSmall, color = InkFaint)
  }
}

@Composable
private fun LedgerAmountRow(label: String, amount: Double) {
  Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(label, color = InkSoft, style = MaterialTheme.typography.bodyMedium)
    Text("₹${"%,.0f".format(amount)}", color = Ink, fontWeight = FontWeight.SemiBold)
  }
}
