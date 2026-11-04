package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.core.Dates
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*

/** E16: this year's holidays and restricted holidays that apply to me, inside Leave. */
@Composable
fun HolidaysScreen(onBack: () -> Unit, vm: LeaveViewModel = hiltViewModel()) {
  val list by vm.holidays.collectAsState()
  val err by vm.holidaysError.collectAsState()
  LaunchedEffect(Unit) { vm.loadHolidays() }
  val today = remember { Dates.todayIso() }
  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Holidays", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    when {
      err != null -> ErrorState(err!!, onRetry = { vm.loadHolidays() })
      list.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No holidays found for this year.", color = InkSoft) }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items(list) { h ->
          Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
              Column(Modifier.weight(1f)) {
                Text(h.name, fontWeight = FontWeight.SemiBold, color = if (h.date < today) InkFaint else Ink)
                Text(Dates.dmy(h.date), color = InkSoft, style = MaterialTheme.typography.bodyMedium)
              }
              Surface(color = (if (h.restricted) Grape else Green).copy(alpha = 0.14f), shape = RoundedCornerShape(20.dp)) {
                Text(if (h.restricted) "Restricted (RH)" else "Holiday", color = if (h.restricted) Grape else Green,
                  style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
              }
            }
          }
        }
      }
    }
  }
}
