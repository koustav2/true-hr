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
import androidx.compose.material.icons.filled.TouchApp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.truehr.app.core.reverseGeocode
import com.truehr.app.core.toJpegBase64
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun MarkAttendanceScreen(onBack: () -> Unit, vm: AttendanceViewModel = hiltViewModel()) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val fused = remember { LocationServices.getFusedLocationProviderClient(context) }

  val punchedIn by vm.punchedIn.collectAsState()
  val completed by vm.completed.collectAsState()
  val submitting by vm.submitting.collectAsState()
  val message by vm.message.collectAsState()

  var pendingType by remember { mutableStateOf<String?>(null) }
  var location by remember { mutableStateOf<Location?>(null) }
  var status by remember { mutableStateOf("Click the \"Punch In\" button to mark your attendance") }

  LaunchedEffect(Unit) { vm.refreshToday() }
  LaunchedEffect(message) { message?.let { status = it } }
  LaunchedEffect(completed) { if (completed) status = "You have completed today's attendance." }

  // Camera (thumbnail) → on capture, reverse-geocode + submit
  val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
    val type = pendingType
    if (bitmap != null && type != null) {
      status = "Submitting your attendance…"
      scope.launch {
        val addr = location?.let { reverseGeocode(context, it.latitude, it.longitude) }
        vm.submitPunch(type, location?.latitude, location?.longitude, addr, bitmap.toJpegBase64())
      }
    } else {
      status = "Photo capture cancelled."
    }
  }

  fun fetchLocationThenCamera() {
    status = "Getting your location…"
    val hasPerm = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (!hasPerm) { status = "Location permission is required."; return }
    try {
      fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
        .addOnSuccessListener { loc -> location = loc; status = "Opening camera…"; cameraLauncher.launch(null) }
        .addOnFailureListener { location = null; status = "Opening camera…"; cameraLauncher.launch(null) }
    } catch (e: SecurityException) {
      status = "Location permission is required."
    }
  }

  val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) fetchLocationThenCamera() else status = "Location permission denied. Enable it to mark attendance."
  }

  fun startPunch(type: String) {
    pendingType = type
    val hasPerm = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (hasPerm) fetchLocationThenCamera() else permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
  }

  val now = remember { Date() }
  val dateFmt = remember { SimpleDateFormat("EEEE, dd MMMM yyyy", Locale.getDefault()) }
  val timeFmt = remember { SimpleDateFormat("hh:mm a", Locale.getDefault()) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Mark Attendance", color = Surface, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
        Spacer(Modifier.width(40.dp))
      }
    }
    Column(Modifier.fillMaxSize().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
          Text("${dateFmt.format(now)}  |  ${timeFmt.format(now)}", fontWeight = FontWeight.SemiBold, color = Ink)
          Spacer(Modifier.height(8.dp))
          Text("General Shift · 9:30 AM to 6:30 PM", color = Teal)
        }
      }
      Spacer(Modifier.height(40.dp))
      Button(
        onClick = { if (!submitting && !completed) startPunch(if (punchedIn) "OUT" else "IN") },
        enabled = !submitting && !completed,
        shape = RoundedCornerShape(30.dp),
        colors = ButtonDefaults.buttonColors(
          containerColor = if (completed) InkFaint else if (punchedIn) Rose else Green,
          contentColor = Surface,
          disabledContainerColor = if (completed) InkFaint.copy(alpha = 0.5f) else Green.copy(alpha = 0.4f),
          disabledContentColor = Surface,
        ),
        modifier = Modifier.height(54.dp).widthIn(min = 210.dp),
      ) {
        if (submitting) {
          CircularProgressIndicator(color = Surface, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        } else {
          Icon(Icons.Filled.TouchApp, null); Spacer(Modifier.width(8.dp))
          Text(if (completed) "COMPLETED" else if (punchedIn) "PUNCH OUT" else "PUNCH IN", fontWeight = FontWeight.Bold)
        }
      }
      Spacer(Modifier.height(18.dp))
      Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.CameraAlt, null, tint = InkFaint, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text("Location + photo are captured and submitted automatically", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
      }
      Spacer(Modifier.height(16.dp))
      Text(status, color = Ink, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
    }
  }
}
