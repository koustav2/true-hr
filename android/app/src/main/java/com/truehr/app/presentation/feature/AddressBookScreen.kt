package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Mail
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.DirectoryEntry
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.initials
import com.truehr.app.presentation.theme.*

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun AddressBookScreen(onBack: () -> Unit, vm: AddressBookViewModel = hiltViewModel()) {
  val s by vm.list.collectAsState()
  var q by remember { mutableStateOf("") }
  LaunchedEffect(Unit) { vm.load() }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Address Book", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    OutlinedTextField(
      value = q, onValueChange = { q = it },
      placeholder = { Text("Search name, ID, state, city…") },
      leadingIcon = { Icon(Icons.Filled.Search, null, tint = Green) },
      singleLine = true, shape = RoundedCornerShape(14.dp),
      colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
      modifier = Modifier.fillMaxWidth().padding(14.dp),
    )
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load() })
      else -> {
        val filtered = (s.data ?: emptyList()).filter {
          q.isBlank() || "${it.name} ${it.employeeCode} ${it.designation} ${it.state} ${it.city}".contains(q, ignoreCase = true)
        }
        if (filtered.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          Text("No employees found.", color = InkSoft)
        } else {
          // Group by state (blank -> "Other")
          val groups = filtered.groupBy { it.state?.trim()?.takeIf { s -> s.isNotBlank() } ?: "Other" }
            .toSortedMap(compareBy { if (it == "Other") "~" else it.lowercase() })
          LazyColumn(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            groups.forEach { (state, people) ->
              stickyHeader {
                Row(
                  Modifier.fillMaxWidth().background(Canvas).padding(vertical = 6.dp),
                  verticalAlignment = Alignment.CenterVertically,
                ) {
                  Icon(Icons.Filled.LocationOn, null, tint = Green, modifier = Modifier.size(16.dp))
                  Spacer(Modifier.width(6.dp))
                  Text(state, color = Ink, fontWeight = FontWeight.Bold)
                  Spacer(Modifier.width(8.dp))
                  Surface(color = Green.copy(alpha = 0.12f), shape = RoundedCornerShape(20.dp)) {
                    Text("${people.size}", color = Green, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
                  }
                }
              }
              items(people) { DirectoryCard(it) }
            }
          }
        }
      }
    }
  }
}

@Composable
private fun DirectoryCard(m: DirectoryEntry) {
  Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp, border = androidx.compose.foundation.BorderStroke(1.dp, Line)) {
    Column(Modifier.padding(14.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(44.dp).clip(CircleShape).background(Green.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
          Text(initials(m.name), color = Green, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
          Text(m.name, fontWeight = FontWeight.Bold, color = Ink)
          Text("${m.employeeCode}  ·  ${m.designation ?: "—"}", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
          if (!m.city.isNullOrBlank()) Text(m.city, color = InkSoft, style = MaterialTheme.typography.labelMedium)
        }
      }
      if (!m.email.isNullOrBlank() || !m.phone.isNullOrBlank()) {
        Spacer(Modifier.height(8.dp))
        if (!m.phone.isNullOrBlank()) ContactLine(Icons.Filled.Phone, m.phone)
        if (!m.email.isNullOrBlank()) { Spacer(Modifier.height(4.dp)); ContactLine(Icons.Filled.Mail, m.email) }
      }
    }
  }
}

@Composable
private fun ContactLine(icon: ImageVector, value: String) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Icon(icon, null, tint = InkFaint, modifier = Modifier.size(14.dp))
    Spacer(Modifier.width(8.dp))
    Text(value, color = InkSoft, style = MaterialTheme.typography.bodyMedium)
  }
}
