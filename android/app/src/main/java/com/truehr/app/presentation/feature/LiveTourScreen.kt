package com.truehr.app.presentation.feature

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.tasks.CancellationTokenSource
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.MapUiSettings
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.truehr.app.core.reverseGeocode
import com.truehr.app.presentation.theme.*
import kotlinx.coroutines.launch

@Composable
fun LiveTourScreen(onBack: () -> Unit, vm: TourViewModel = hiltViewModel()) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val fused = remember { LocationServices.getFusedLocationProviderClient(context) }

  val active by vm.activeTour.collectAsState()
  val path by vm.path.collectAsState()
  val status by vm.status.collectAsState()

  var hasLocationPermission by remember {
    mutableStateOf(
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED,
    )
  }

  val cameraState = rememberCameraPositionState {
    position = CameraPosition.fromLatLngZoom(LatLng(22.5726, 88.3639), 5f) // India default
  }

  // Center on the user once we have a fix.
  LaunchedEffect(hasLocationPermission) {
    if (!hasLocationPermission) return@LaunchedEffect
    try {
      fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
        .addOnSuccessListener { l -> if (l != null) cameraState.position = CameraPosition.fromLatLngZoom(LatLng(l.latitude, l.longitude), 15f) }
    } catch (_: SecurityException) { }
  }

  // Keep the camera following the latest recorded point during a tour.
  val pathLatLng = remember(path) { path.map { LatLng(it.lat, it.lng) } }
  LaunchedEffect(pathLatLng.size) {
    pathLatLng.lastOrNull()?.let { cameraState.position = CameraPosition.fromLatLngZoom(it, 16f) }
  }

  val backgroundPermLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
  val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
    hasLocationPermission = result[Manifest.permission.ACCESS_FINE_LOCATION] == true
  }

  fun ensurePermissions(): Boolean {
    if (!hasLocationPermission) {
      val perms = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) perms.add(Manifest.permission.POST_NOTIFICATIONS)
      permLauncher.launch(perms.toTypedArray())
      return false
    }
    // Best-effort: ask for "all the time" so tracking survives screen-off.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
      backgroundPermLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    }
    return true
  }

  fun withLocation(onResult: (Location?) -> Unit) {
    try {
      fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
        .addOnSuccessListener(onResult)
        .addOnFailureListener { onResult(null) }
    } catch (_: SecurityException) { onResult(null) }
  }

  fun onStart() {
    if (!ensurePermissions()) return
    withLocation { l ->
      scope.launch {
        val addr = l?.let { reverseGeocode(context, it.latitude, it.longitude) }
        vm.startTour(l?.latitude, l?.longitude, addr)
      }
    }
  }

  fun onEnd() {
    val a = active ?: return
    withLocation { l ->
      scope.launch {
        val addr = l?.let { reverseGeocode(context, it.latitude, it.longitude) }
        vm.endTour(a, l?.latitude, l?.longitude, addr)
      }
    }
  }

  Box(Modifier.fillMaxSize().background(Canvas)) {
    GoogleMap(
      modifier = Modifier.fillMaxSize(),
      cameraPositionState = cameraState,
      properties = MapProperties(isMyLocationEnabled = hasLocationPermission),
      uiSettings = MapUiSettings(myLocationButtonEnabled = hasLocationPermission, zoomControlsEnabled = false),
    ) {
      if (pathLatLng.size >= 2) Polyline(points = pathLatLng, color = Green, width = 12f)
      active?.let { a ->
        if (a.startLat != null && a.startLng != null) {
          Marker(state = MarkerState(LatLng(a.startLat!!, a.startLng!!)), title = "Start")
        }
      }
      pathLatLng.lastOrNull()?.let { Marker(state = MarkerState(it), title = "Current") }
    }

    // Top bar
    Row(
      Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Surface(shape = RoundedCornerShape(50), color = Surface, shadowElevation = 2.dp) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Ink) }
      }
      Spacer(Modifier.width(10.dp))
      Surface(shape = RoundedCornerShape(50), color = Surface, shadowElevation = 2.dp) {
        Text("Live Tour Tracking", color = Ink, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
      }
    }

    // Bottom action bar
    Surface(
      color = Surface, shadowElevation = 8.dp,
      shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp),
      modifier = Modifier.fillMaxWidth().align(Alignment.BottomCenter),
    ) {
      Column(Modifier.padding(14.dp).navigationBarsPadding()) {
        status?.let {
          Text(it, color = if (active != null) Green else InkSoft, style = MaterialTheme.typography.bodyMedium)
          Spacer(Modifier.height(8.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          Button(
            onClick = { onStart() },
            enabled = active == null,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Surface, disabledContainerColor = InkFaint.copy(alpha = 0.4f), disabledContentColor = Surface),
            modifier = Modifier.weight(1f).height(52.dp),
          ) { Icon(Icons.Filled.PlayArrow, null); Spacer(Modifier.width(6.dp)); Text("Start Tour", fontWeight = FontWeight.Bold) }

          Button(
            onClick = { onEnd() },
            enabled = active != null,
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Pink, contentColor = Surface, disabledContainerColor = InkFaint.copy(alpha = 0.4f), disabledContentColor = Surface),
            modifier = Modifier.weight(1f).height(52.dp),
          ) { Icon(Icons.Filled.Stop, null); Spacer(Modifier.width(6.dp)); Text("End Tour", fontWeight = FontWeight.Bold) }
        }
      }
    }
  }
}
