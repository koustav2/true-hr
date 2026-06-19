package com.truehr.app.presentation.feature

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.location.Location
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.EditCalendar
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.truehr.app.core.reverseGeocode
import com.truehr.app.core.toJpegBase64
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private val ISO = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

@OptIn(ExperimentalMaterial3Api::class)
private class FutureOnlyDates(private val minMillis: Long) : SelectableDates {
  override fun isSelectableDate(utcTimeMillis: Long): Boolean = utcTimeMillis >= minMillis
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApplyOdScreen(onBack: () -> Unit, vm: OnDutyViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val p by profileVm.state.collectAsState()
  val submitting by vm.submitting.collectAsState()
  val applyError by vm.applyError.collectAsState()
  val applied by vm.applied.collectAsState()
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val fused = remember { LocationServices.getFusedLocationProviderClient(context) }

  var fromDate by remember { mutableStateOf("") }
  var toDate by remember { mutableStateOf("") }
  var dayType by remember { mutableStateOf("FULL") }
  var place by remember { mutableStateOf("") }
  var reason by remember { mutableStateOf("") }
  var photo by remember { mutableStateOf<Bitmap?>(null) }
  var loc by remember { mutableStateOf<Location?>(null) }
  var address by remember { mutableStateOf<String?>(null) }
  var capStatus by remember { mutableStateOf<String?>(null) }

  // Same flow as Mark Attendance: get location -> open camera -> reverse-geocode -> fill place.
  val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bmp ->
    if (bmp != null) {
      photo = bmp
      capStatus = "Reading location…"
      scope.launch {
        val addr = loc?.let { reverseGeocode(context, it.latitude, it.longitude) }
        address = addr
        if (!addr.isNullOrBlank() && place.isBlank()) place = addr
        capStatus = if (addr != null) "Captured" else "Photo captured (no address)"
      }
    } else capStatus = "Capture cancelled"
  }

  fun fetchLocationThenCamera() {
    capStatus = "Getting your location…"
    try {
      fused.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, CancellationTokenSource().token)
        .addOnSuccessListener { l -> loc = l; cameraLauncher.launch(null) }
        .addOnFailureListener { loc = null; cameraLauncher.launch(null) }
    } catch (e: SecurityException) { capStatus = "Location permission is required." }
  }

  val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) fetchLocationThenCamera() else capStatus = "Location permission denied."
  }

  fun startCapture() {
    val ok = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    if (ok) fetchLocationThenCamera() else permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
  }

  // Close the screen shortly after a successful submit.
  LaunchedEffect(applied) { if (applied) { delay(700); onBack() } }

  var picker by remember { mutableStateOf<String?>(null) }   // "FROM" | "TO" | null

  if (picker != null) {
    // OD is for future dates only — disable today & past in the picker.
    val tomorrowStart = remember {
      java.util.Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
        add(java.util.Calendar.DAY_OF_YEAR, 1); set(java.util.Calendar.HOUR_OF_DAY, 0); set(java.util.Calendar.MINUTE, 0); set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
      }.timeInMillis
    }
    val state = rememberDatePickerState(selectableDates = FutureOnlyDates(tomorrowStart))
    DatePickerDialog(
      onDismissRequest = { picker = null },
      confirmButton = {
        TextButton(onClick = {
          state.selectedDateMillis?.let { ms ->
            val v = ISO.format(Date(ms))
            if (picker == "FROM") { fromDate = v; if (toDate.isBlank() || toDate < v) toDate = v }
            else toDate = v
          }
          picker = null
        }) { Text("OK") }
      },
      dismissButton = { TextButton(onClick = { picker = null }) { Text("Cancel") } },
    ) { DatePicker(state = state) }
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Apply OD", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
      InfoCard {
        OdCardHeader(Icons.Filled.Badge, "Employee Details")
        InfoRow("Employee Code", p.data?.employeeCode)
        InfoRow("Name", p.data?.fullName)
        InfoRow("Designation", p.data?.designation)
        InfoRow("Vertical", p.data?.department)
        InfoRow("Location", p.data?.location)
      }
      InfoCard {
        OdCardHeader(Icons.Filled.EditCalendar, "On-Duty Details")
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          DateField("From Date", fromDate, Modifier.weight(1f)) { picker = "FROM" }
          DateField("To Date", toDate, Modifier.weight(1f)) { picker = "TO" }
        }
        Spacer(Modifier.height(14.dp))
        Text("Duration", color = InkFaint, style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          FilterChip(selected = dayType == "FULL", onClick = { dayType = "FULL" }, label = { Text("Full Day") })
          FilterChip(selected = dayType == "HALF", onClick = { dayType = "HALF" }, label = { Text("Half Day") })
        }
        Spacer(Modifier.height(14.dp))
        AppTextField(place, { place = it }, "Place / Location of duty")
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(reason, { reason = it }, label = { Text("Reason / Purpose") }, minLines = 3,
          shape = RoundedCornerShape(12.dp), colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
          modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(14.dp))
        Text("Location + Photo", color = InkFaint, style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          val pic = photo
          if (pic != null) {
            Image(pic.asImageBitmap(), contentDescription = "OD photo", contentScale = ContentScale.Crop,
              modifier = Modifier.size(64.dp).clip(RoundedCornerShape(12.dp)))
          }
          OutlinedButton(onClick = { startCapture() }, shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Green)) {
            Icon(Icons.Filled.CameraAlt, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
            Text(if (pic == null) "Capture location + photo" else "Retake")
          }
        }
        capStatus?.let { Spacer(Modifier.height(6.dp)); Text(it, color = if (photo != null) Green else InkFaint, style = MaterialTheme.typography.labelSmall) }
        if (!address.isNullOrBlank()) {
          Spacer(Modifier.height(4.dp))
          Row(verticalAlignment = Alignment.Top) {
            Icon(Icons.Filled.Place, null, tint = InkFaint, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp))
            Text(address!!, color = InkSoft, style = MaterialTheme.typography.labelSmall, maxLines = 3)
          }
        }
      }
      applyError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      if (applied) Text("Your on-duty request has been submitted.", color = Green, fontWeight = FontWeight.SemiBold)
      PrimaryButton(if (submitting) "" else "Submit", loading = submitting, onClick = {
        vm.apply(fromDate, toDate, dayType, place, reason, photo?.toJpegBase64(), loc?.latitude, loc?.longitude, address)
      }, modifier = Modifier.fillMaxWidth())
      Spacer(Modifier.height(8.dp))
    }
  }
}

@Composable
private fun DateField(label: String, value: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
  OutlinedTextField(
    value = value, onValueChange = {}, readOnly = true, enabled = false, label = { Text(label) },
    trailingIcon = { Icon(Icons.Filled.CalendarMonth, null, tint = Green) },
    shape = RoundedCornerShape(12.dp),
    colors = OutlinedTextFieldDefaults.colors(
      disabledBorderColor = Line, disabledLabelColor = InkFaint, disabledTextColor = Ink,
      disabledTrailingIconColor = Green,
    ),
    modifier = modifier.fillMaxWidth().clickable(onClick = onClick),
  )
}

@Composable
private fun OdCardHeader(icon: ImageVector, title: String) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Box(Modifier.size(34.dp).clip(CircleShape).background(Green.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
      Icon(icon, null, tint = Green, modifier = Modifier.size(18.dp))
    }
    Spacer(Modifier.width(10.dp))
    Text(title, fontWeight = FontWeight.Bold, color = Ink)
  }
  Spacer(Modifier.height(4.dp))
  HorizontalDivider(color = Line)
  Spacer(Modifier.height(10.dp))
}
