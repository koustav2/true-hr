package com.truehr.app.presentation.feature

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.verticalScroll
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
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.compose.runtime.saveable.rememberSaveable
import com.truehr.app.core.LocationHelper
import com.truehr.app.core.launchSafely
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

  val submitting by vm.submitting.collectAsState()
  val applyError by vm.applyError.collectAsState()
  val fieldErrors by vm.fieldErrors.collectAsState()
  val applied by vm.applied.collectAsState()
  val canApply by vm.canApply.collectAsState()
  val eligibilityReason by vm.eligibilityReason.collectAsState()

  // Saved across process death (the camera can push the app out of memory).
  var place by rememberSaveable { mutableStateOf("") }
  var purpose by rememberSaveable { mutableStateOf("") }
  var fixLat by rememberSaveable { mutableStateOf<Double?>(null) }
  var fixLng by rememberSaveable { mutableStateOf<Double?>(null) }
  var status by rememberSaveable { mutableStateOf("Enter the place and purpose, then tap \"Apply OD\" to capture your location & photo.") }

  LaunchedEffect(Unit) { vm.loadEligibility() }
  LaunchedEffect(eligibilityReason) { eligibilityReason?.let { status = it } }
  LaunchedEffect(applyError) { applyError?.let { status = it } }
  LaunchedEffect(applied) { if (applied) { status = "On-duty submitted successfully."; delay(900); onBack() } }

  val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
    val lat = fixLat; val lng = fixLng
    if (bitmap != null && lat != null && lng != null) {
      status = "Submitting your on-duty…"
      scope.launch {
        val addr = reverseGeocode(context, lat, lng)
        val today = com.truehr.app.core.Dates.todayIso()
        vm.apply(today, today, "FULL", place, purpose, bitmap.toJpegBase64(), lat, lng, addr)
      }
    } else status = if (bitmap == null) "Photo capture cancelled." else "Location was lost. Please try again."
  }

  fun fetchLocationThenCamera() {
    status = "Getting your location…"
    scope.launch {
      when (val fix = LocationHelper.current(context)) {
        is LocationHelper.Fix.Ok -> {
          fixLat = fix.location.latitude; fixLng = fix.location.longitude
          status = "Opening camera…"
          if (!cameraLauncher.launchSafely(context, null)) status = "No camera app is available on this phone."
        }
        is LocationHelper.Fix.Failed -> status = fix.message
      }
    }
  }

  val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
    if (LocationHelper.granted(result)) fetchLocationThenCamera() else status = LocationHelper.MSG_DENIED
  }

  fun start() {
    // Place and purpose are required (v2) — check before the camera opens.
    if (!vm.checkFields(place, purpose)) { status = "Please fill in the highlighted fields."; return }
    if (LocationHelper.hasAny(context)) fetchLocationThenCamera() else permissionLauncher.launch(LocationHelper.PERMISSIONS)
  }

  var now by remember { mutableStateOf(Date()) }
  LaunchedEffect(Unit) { while (true) { now = Date(); delay(1_000) } }
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
    Column(Modifier.fillMaxSize().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
      Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
          Text("${dateFmt.format(now)}  |  ${timeFmt.format(now)}", fontWeight = FontWeight.SemiBold, color = Ink)
          Spacer(Modifier.height(8.dp))
          Text("On-Duty / Field work for today", color = Teal)
        }
      }
      Spacer(Modifier.height(16.dp))
      com.truehr.app.presentation.components.AppTextField(place, { place = it.take(200); vm.clearFieldError("place") }, "Place of duty *")
      com.truehr.app.presentation.components.FieldError(fieldErrors["place"])
      Spacer(Modifier.height(10.dp))
      com.truehr.app.presentation.components.AppTextField(purpose, { purpose = it.take(500); vm.clearFieldError("reason") }, "Purpose *")
      com.truehr.app.presentation.components.FieldError(fieldErrors["reason"])
      Spacer(Modifier.height(24.dp))
      Button(
        onClick = { if (!submitting && canApply) start() },
        enabled = !submitting && canApply,
        shape = RoundedCornerShape(30.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Green, contentColor = Surface, disabledContainerColor = InkFaint.copy(alpha = 0.4f), disabledContentColor = Surface),
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
