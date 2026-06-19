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
import androidx.compose.material.icons.filled.Work
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// One-tap On-Duty: same flow as Mark Attendance — get location, open camera, auto-submit.
@Composable
fun ApplyOdScreen(onBack: () -> Unit, vm: OnDutyViewModel = hiltViewModel()) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val fused = remember { LocationServices.getFusedLocationProviderClient(context) }

  val submitting by vm.submitting.collectAsState()
  val applyError by vm.applyError.collectAsState()
  val applied by vm.applied.collectAsState()

  var location by remember { mutableStateOf<Location?>(null) }
  var status by remember { mutableStateOf("Tap \"Apply OD\" to capture your on-duty location & photo.") }

  LaunchedEffect(applyError) { applyError?.let { status = it } }
  LaunchedEffect(applied) { if (applied) { status = "On-duty submitted successfully."; delay(900); onBack() } }

  val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
    if (bitmap != null) {
      status = "Submitting your on-duty…"
      scope.launch {
        val addr = location?.let { reverseGeocode(context, it.latitude, it.longitude) }
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        vm.apply(today, today, "FULL", addr ?: "", "", bitmap.toJpegBase64(), location?.latitude, location?.longitude, addr)
      }
    } else status = "Photo capture cancelled."
  }

  fun fetchLocationThenCamera() {
    status = "Getting your location…"
    try {
      fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
        .addOnSuccessListener { l -> location = l; status = "Opening camera…"; cameraLauncher.launch(null) }
        .addOnFailureListener { location = null; status = "Opening camera…"; cameraLauncher.launch(null) }
    } catch (e: SecurityException) { status = "Location permission is required." }
  }

  val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) fetchLocationThenCamera() else status = "Location permission denied. Enable it to apply OD."
  }

  fun start() {
    val ok = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (ok) fetchLocationThenCamera() else permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
  }

  val now = remember { Date() }
  val dateFmt = remember { SimpleDateFormat("EEEE, dd MMMM yyyy", Locale.getDefault()) }
  val timeFmt = remember { SimpleDateFormat("hh:mm a", Locale.getDefault()) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Apply OD", color = Surface, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
        Spacer(Modifier.width(40.dp))
      }
    }
    Column(Modifier.fillMaxSize().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
          Text("${dateFmt.format(now)}  |  ${timeFmt.format(now)}", fontWeight = FontWeight.SemiBold, color = Ink)
          Spacer(Modifier.height(8.dp))
          Text("On-Duty / Field work for today", color = Teal)
        }
      }
      Spacer(Modifier.height(40.dp))
      Button(
        onClick = { if (!submitting) start() },
        enabled = !submitting,
        shape = RoundedCornerShape(30.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Green, contentColor = Surface, disabledContainerColor = Green.copy(alpha = 0.4f), disabledContentColor = Surface),
        modifier = Modifier.height(54.dp).widthIn(min = 210.dp),
      ) {
        if (submitting) CircularProgressIndicator(color = Surface, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        else { Icon(Icons.Filled.Work, null); Spacer(Modifier.width(8.dp)); Text("APPLY OD", fontWeight = FontWeight.Bold) }
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
