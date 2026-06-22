package com.truehr.app.presentation.feature

import android.Manifest
import android.content.pm.PackageManager
import android.location.Location
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import com.google.maps.android.compose.rememberCameraPositionState
import com.truehr.app.core.reverseGeocode
import com.truehr.app.core.stampGeotag
import com.truehr.app.core.toJpegBase64
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun GeoTagScreen(onBack: () -> Unit, vm: TourViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val fused = remember { LocationServices.getFusedLocationProviderClient(context) }
  val p by profileVm.state.collectAsState()
  val saved by vm.geotagSaved.collectAsState()

  var hasPermission by remember {
    mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
  }
  var remark by remember { mutableStateOf("") }
  var status by remember { mutableStateOf<String?>(null) }
  var pendingLocation by remember { mutableStateOf<Location?>(null) }

  val cameraState = rememberCameraPositionState {
    position = CameraPosition.fromLatLngZoom(LatLng(22.5726, 88.3639), 5f)
  }
  LaunchedEffect(hasPermission) {
    if (!hasPermission) return@LaunchedEffect
    try {
      fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
        .addOnSuccessListener { l -> if (l != null) cameraState.position = CameraPosition.fromLatLngZoom(LatLng(l.latitude, l.longitude), 16f) }
    } catch (_: SecurityException) { }
  }
  LaunchedEffect(saved) { if (saved) { status = "Geo-tag saved."; vm.consumeGeotagSaved(); onBack() } }

  val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
    if (bitmap == null) { status = "Capture cancelled."; return@rememberLauncherForActivityResult }
    status = "Saving geo-tag…"
    scope.launch {
      val loc = pendingLocation
      val addr = loc?.let { reverseGeocode(context, it.latitude, it.longitude) }
      val now = SimpleDateFormat("dd-MM-yyyy HH:mm:ss", Locale.getDefault()).format(Date())
      val lines = listOf(
        "True HR ESS",
        "Emp Name: ${p.data?.fullName ?: "-"}",
        "Emp Code: ${p.data?.employeeCode ?: "-"}",
        now,
        "Address: ${addr ?: "-"}",
        "Lat: ${loc?.latitude?.let { String.format(Locale.US, "%.5f", it) } ?: "-"}, " +
          "Lon: ${loc?.longitude?.let { String.format(Locale.US, "%.5f", it) } ?: "-"}",
        "Details: ${remark.ifBlank { "-" }}",
      )
      val stamped = stampGeotag(bitmap, lines)
      vm.captureGeotag(loc?.latitude, loc?.longitude, addr, stamped.toJpegBase64(70), remark.ifBlank { null })
    }
  }

  val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    hasPermission = granted
    if (granted) status = "Permission granted — tap Capture again." else status = "Location permission is required."
  }

  fun capture() {
    if (!hasPermission) { permLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION); return }
    status = "Getting location…"
    try {
      fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
        .addOnSuccessListener { l -> pendingLocation = l; status = "Opening camera…"; cameraLauncher.launch(null) }
        .addOnFailureListener { pendingLocation = null; status = "Opening camera…"; cameraLauncher.launch(null) }
    } catch (_: SecurityException) { status = "Location permission is required." }
  }

  Box(Modifier.fillMaxSize().background(Canvas)) {
    GoogleMap(
      modifier = Modifier.fillMaxSize(),
      cameraPositionState = cameraState,
      properties = MapProperties(isMyLocationEnabled = hasPermission),
      uiSettings = MapUiSettings(myLocationButtonEnabled = hasPermission, zoomControlsEnabled = false),
    ) {
      Marker(state = MarkerState(cameraState.position.target), title = "Here")
    }

    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
      Surface(shape = RoundedCornerShape(50), color = Surface, shadowElevation = 2.dp) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Ink) }
      }
      Spacer(Modifier.width(10.dp))
      Surface(shape = RoundedCornerShape(50), color = Surface, shadowElevation = 2.dp) {
        Text("GeoTag Image", color = Ink, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
      }
    }

    Surface(
      color = Surface, shadowElevation = 8.dp,
      shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp),
      modifier = Modifier.fillMaxWidth().align(Alignment.BottomCenter),
    ) {
      Column(Modifier.padding(14.dp).navigationBarsPadding()) {
        OutlinedTextField(
          value = remark, onValueChange = { remark = it },
          label = { Text("Remark / details") }, singleLine = true,
          shape = RoundedCornerShape(12.dp),
          colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green, focusedLabelColor = Green, cursorColor = Green),
          modifier = Modifier.fillMaxWidth(),
        )
        status?.let { Spacer(Modifier.height(8.dp)); Text(it, color = InkSoft, style = MaterialTheme.typography.bodyMedium) }
        Spacer(Modifier.height(10.dp))
        Button(
          onClick = { capture() },
          shape = RoundedCornerShape(12.dp),
          colors = ButtonDefaults.buttonColors(containerColor = Teal, contentColor = Surface),
          modifier = Modifier.fillMaxWidth().height(52.dp),
        ) { Icon(Icons.Filled.CameraAlt, null); Spacer(Modifier.width(8.dp)); Text("Capture Image", fontWeight = FontWeight.Bold) }
      }
    }
  }
}
