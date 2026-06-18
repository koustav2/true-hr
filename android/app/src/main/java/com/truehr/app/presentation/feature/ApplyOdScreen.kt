package com.truehr.app.presentation.feature

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.core.toJpegBase64
import com.truehr.app.presentation.components.*
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private val ISO = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApplyOdScreen(onBack: () -> Unit, vm: OnDutyViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val p by profileVm.state.collectAsState()
  val submitting by vm.submitting.collectAsState()
  val applyError by vm.applyError.collectAsState()
  val applied by vm.applied.collectAsState()

  var fromDate by remember { mutableStateOf("") }
  var toDate by remember { mutableStateOf("") }
  var dayType by remember { mutableStateOf("FULL") }
  var place by remember { mutableStateOf("") }
  var reason by remember { mutableStateOf("") }
  var photo by remember { mutableStateOf<Bitmap?>(null) }

  val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bmp ->
    if (bmp != null) photo = bmp
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
    val state = rememberDatePickerState(
      selectableDates = object : SelectableDates {
        override fun isSelectableDate(utcTimeMillis: Long) = utcTimeMillis >= tomorrowStart
        override fun isSelectableYear(year: Int) = year >= java.util.Calendar.getInstance().get(java.util.Calendar.YEAR)
      },
    )
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
        Text("Photo", color = InkFaint, style = MaterialTheme.typography.labelMedium)
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
          val pic = photo
          if (pic != null) {
            Image(pic.asImageBitmap(), contentDescription = "OD photo", contentScale = ContentScale.Crop,
              modifier = Modifier.size(64.dp).clip(RoundedCornerShape(12.dp)))
          }
          OutlinedButton(onClick = { cameraLauncher.launch(null) }, shape = RoundedCornerShape(10.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = Green)) {
            Icon(Icons.Filled.CameraAlt, null, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(6.dp))
            Text(if (pic == null) "Capture photo" else "Retake")
          }
        }
      }
      applyError?.let { Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      if (applied) Text("Your on-duty request has been submitted.", color = Green, fontWeight = FontWeight.SemiBold)
      PrimaryButton(if (submitting) "" else "Submit", loading = submitting, onClick = {
        vm.apply(fromDate, toDate, dayType, place, reason, photo?.toJpegBase64())
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
