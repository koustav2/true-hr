package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.truehr.app.core.Formats
import com.truehr.app.domain.model.Tour
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.theme.*
import java.text.SimpleDateFormat
import java.util.Locale

@Composable
fun TourRouteScreen(tourId: Long, onBack: () -> Unit, vm: TourViewModel = hiltViewModel()) {
  val s by vm.detail.collectAsState()
  LaunchedEffect(tourId) { vm.loadDetail(tourId) }

  Box(Modifier.fillMaxSize().background(Canvas)) {
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.loadDetail(tourId) })
      s.data != null -> RouteBody(s.data!!)
    }

    // Top bar overlay
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
      Surface(shape = RoundedCornerShape(50), color = Surface, shadowElevation = 2.dp) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Ink) }
      }
      Spacer(Modifier.width(10.dp))
      Surface(shape = RoundedCornerShape(50), color = Surface, shadowElevation = 2.dp) {
        Text("Tour Route", color = Ink, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
      }
    }
  }
}

@Composable
private fun RouteBody(t: Tour) {
  val pts = remember(t) { t.points.map { LatLng(it.lat, it.lng) } }
  val cam = rememberCameraPositionState {
    position = CameraPosition.fromLatLngZoom(pts.firstOrNull() ?: LatLng(t.startLat ?: 22.5726, t.startLng ?: 88.3639), 14f)
  }
  // Fit the whole route into view once it's loaded.
  LaunchedEffect(pts) {
    if (pts.size >= 2) {
      runCatching {
        val b = LatLngBounds.builder().apply { pts.forEach { include(it) } }.build()
        cam.animate(CameraUpdateFactory.newLatLngBounds(b, 120))
      }
    }
  }

  Box(Modifier.fillMaxSize()) {
    GoogleMap(
      modifier = Modifier.fillMaxSize(),
      cameraPositionState = cam,
      uiSettings = MapUiSettings(zoomControlsEnabled = false),
    ) {
      if (pts.size >= 2) Polyline(points = pts, color = Green, width = 14f)
      if (t.startLat != null && t.startLng != null) Marker(state = MarkerState(LatLng(t.startLat, t.startLng)), title = "Start")
      if (t.endLat != null && t.endLng != null) Marker(state = MarkerState(LatLng(t.endLat, t.endLng)), title = "End")
    }

    // Summary card
    Surface(
      color = Surface, shadowElevation = 8.dp,
      shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp),
      modifier = Modifier.fillMaxWidth().align(Alignment.BottomCenter),
    ) {
      Column(Modifier.padding(16.dp).navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
          Text("Tour ID: ${t.id}", fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, color = Ink, modifier = Modifier.weight(1f))
          Surface(color = Green.copy(alpha = 0.12f), shape = RoundedCornerShape(20.dp)) {
            Text("Total: ${String.format(Locale.US, "%.2f", t.distanceKm)} km", color = Green, fontWeight = androidx.compose.ui.text.font.FontWeight.Bold, modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp))
          }
        }
        Spacer(Modifier.height(10.dp))
        Line(Icons.Filled.FiberManualRecord, "Start", fmt(t.startedAt), t.startAddress)
        Spacer(Modifier.height(6.dp))
        Line(Icons.Filled.Stop, "End", fmt(t.endedAt), t.endAddress)
      }
    }
  }
}

@Composable
private fun Line(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, time: String, addr: String?) {
  Row(verticalAlignment = Alignment.Top) {
    Icon(icon, null, tint = Teal, modifier = Modifier.size(18.dp))
    Spacer(Modifier.width(8.dp))
    Column {
      Text("$label · $time", fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, color = Ink, style = MaterialTheme.typography.bodyMedium)
      Text(addr ?: "—", color = InkSoft, style = MaterialTheme.typography.bodySmall)
    }
  }
}

private fun fmt(iso: String?): String {
  if (iso == null) return "—"
  val d = Formats.parse(iso) ?: return iso.take(10)
  return SimpleDateFormat("dd-MM-yyyy HH:mm", Locale.getDefault()).format(d)
}
