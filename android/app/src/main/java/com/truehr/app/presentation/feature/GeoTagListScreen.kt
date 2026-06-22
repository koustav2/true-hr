package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.Apartment
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.truehr.app.BuildConfig
import com.truehr.app.core.Formats
import com.truehr.app.domain.model.Geotag
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*
import java.text.SimpleDateFormat
import java.util.Locale

@Composable
fun GeoTagListScreen(onBack: () -> Unit, vm: TourViewModel = hiltViewModel()) {
  val s by vm.geotags.collectAsState()
  LaunchedEffect(Unit) { vm.loadGeotags(null, null) }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Geo Tag List", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!) { vm.loadGeotags(null, null) }
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No geo-tags captured yet.", color = InkSoft) }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        items(s.data!!) { g -> GeotagCard(g) }
      }
    }
  }
}

@Composable
private fun GeotagCard(g: Geotag) {
  Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
    Column {
      AsyncImage(
        model = "${BuildConfig.BASE_URL}geotags/${g.id}/photo",
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = Modifier.fillMaxWidth().height(190.dp).clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)),
      )
      Column(Modifier.padding(16.dp)) {
        InfoLine(Icons.Filled.Badge, "Employee Code:", g.employeeCode ?: "—")
        InfoLine(Icons.Filled.CalendarMonth, "Date:", fmtDate(g.capturedAt))
        InfoLine(Icons.Filled.Apartment, "Address:", buildString {
          append(g.address ?: "—")
          if (g.lat != null && g.lng != null) append("  (Lat: ${String.format(Locale.US, "%.4f", g.lat)}, Lng: ${String.format(Locale.US, "%.4f", g.lng)})")
        })
        if (!g.remark.isNullOrBlank()) InfoLine(Icons.AutoMirrored.Filled.Message, "Remark:", g.remark)
      }
    }
  }
}

@Composable
private fun InfoLine(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String) {
  Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
    Icon(icon, null, tint = Teal, modifier = Modifier.size(18.dp))
    Spacer(Modifier.width(8.dp))
    Text("$label ", fontWeight = FontWeight.Bold, color = Ink)
    Spacer(Modifier.width(2.dp))
    Text(value, color = InkSoft)
  }
}

private fun fmtDate(iso: String?): String {
  if (iso == null) return "—"
  val d = Formats.parse(iso) ?: return iso.take(10)
  return SimpleDateFormat("dd/MM/yyyy", Locale.getDefault()).format(d)
}
