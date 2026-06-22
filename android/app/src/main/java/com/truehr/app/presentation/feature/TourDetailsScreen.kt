package com.truehr.app.presentation.feature

import android.app.DatePickerDialog
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.maps.GoogleMapOptions
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.rememberCameraPositionState
import com.truehr.app.core.Formats
import com.truehr.app.domain.model.Tour
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

private val ymd = SimpleDateFormat("yyyy-MM-dd", Locale.US)
private val pretty = SimpleDateFormat("MMM dd, yyyy", Locale.getDefault())

@Composable
fun TourDetailsScreen(onBack: () -> Unit, vm: TourViewModel = hiltViewModel()) {
  val context = LocalContext.current
  val s by vm.tours.collectAsState()

  val fromCal = remember { Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -90) } }
  val toCal = remember { Calendar.getInstance() }
  var fromText by remember { mutableStateOf(pretty.format(fromCal.time)) }
  var toText by remember { mutableStateOf(pretty.format(toCal.time)) }

  fun pick(cal: Calendar, onSet: () -> Unit) {
    DatePickerDialog(context, { _, y, m, d -> cal.set(y, m, d); onSet() },
      cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)).show()
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Tour Details", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }

    Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      DateChip(fromText, Modifier.weight(1f)) { pick(fromCal) { fromText = pretty.format(fromCal.time) } }
      DateChip(toText, Modifier.weight(1f)) { pick(toCal) { toText = pretty.format(toCal.time) } }
    }
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
      Button(
        onClick = { vm.loadTours(ymd.format(fromCal.time), ymd.format(toCal.time)) },
        shape = RoundedCornerShape(50),
        colors = ButtonDefaults.buttonColors(containerColor = Green, contentColor = Surface),
      ) { Text("View Tours", fontWeight = FontWeight.SemiBold) }
    }
    Spacer(Modifier.height(8.dp))

    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!) { vm.loadTours(ymd.format(fromCal.time), ymd.format(toCal.time)) }
      s.data == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Pick a range and tap View Tours.", color = InkSoft) }
      s.data!!.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No tours in this range.", color = InkSoft) }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        items(s.data!!) { t -> TourCard(t) }
      }
    }
  }
}

@Composable
private fun DateChip(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
  Surface(color = Surface, shape = RoundedCornerShape(50), shadowElevation = 1.dp,
    border = androidx.compose.foundation.BorderStroke(1.dp, Line),
    modifier = modifier.clickable(onClick = onClick)) {
    Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
      Icon(Icons.Filled.CalendarMonth, null, tint = Teal, modifier = Modifier.size(18.dp))
      Spacer(Modifier.width(8.dp))
      Text(text, color = Ink, fontWeight = FontWeight.Medium)
    }
  }
}

@Composable
private fun TourCard(t: Tour) {
  Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
    Column {
      val center = LatLng(t.startLat ?: 22.5726, t.startLng ?: 88.3639)
      val cam = rememberCameraPositionState(key = "tour_${t.id}") {
        position = CameraPosition.fromLatLngZoom(center, if (t.startLat != null) 15f else 4f)
      }
      GoogleMap(
        modifier = Modifier.fillMaxWidth().height(160.dp).clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)),
        cameraPositionState = cam,
        googleMapOptionsFactory = { GoogleMapOptions().liteMode(true) },
        uiSettings = MapUiSettings(zoomControlsEnabled = false, scrollGesturesEnabled = false),
      ) {
        if (t.startLat != null && t.startLng != null) Marker(state = MarkerState(LatLng(t.startLat, t.startLng)), title = "Start")
        if (t.endLat != null && t.endLng != null) Marker(state = MarkerState(LatLng(t.endLat, t.endLng)), title = "End")
      }
      Column(Modifier.padding(16.dp)) {
        Text("Tour ID: ${t.id}", fontWeight = FontWeight.Bold, color = Ink, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(10.dp))
        TourLine(Icons.Filled.FiberManualRecord, "Start:", fmtDate(t.startedAt))
        TourLine(Icons.Filled.Place, "From:", t.startAddress ?: "—")
        Spacer(Modifier.height(6.dp))
        TourLine(Icons.Filled.Stop, "End:", fmtDate(t.endedAt))
        TourLine(Icons.Filled.Place, "To:", t.endAddress ?: "—")
        Spacer(Modifier.height(8.dp))
        Text("Dist: ${String.format(Locale.US, "%.2f", t.distanceKm)} km", fontWeight = FontWeight.Bold, color = Ink)
      }
    }
  }
}

@Composable
private fun TourLine(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String) {
  Row(Modifier.padding(vertical = 3.dp), verticalAlignment = Alignment.Top) {
    Icon(icon, null, tint = Teal, modifier = Modifier.size(18.dp))
    Spacer(Modifier.width(8.dp))
    Text("$label ", fontWeight = FontWeight.SemiBold, color = Ink)
    Text(value, color = InkSoft)
  }
}

private fun fmtDate(iso: String?): String {
  if (iso == null) return "—"
  val d = Formats.parse(iso) ?: return iso.take(10)
  return SimpleDateFormat("dd-MM-yyyy", Locale.getDefault()).format(d)
}
