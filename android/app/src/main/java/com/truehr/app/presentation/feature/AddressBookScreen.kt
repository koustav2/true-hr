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

@Composable
fun AddressBookScreen(onBack: () -> Unit, vm: AddressBookViewModel = hiltViewModel()) {
  val s by vm.list.collectAsState()
  var q by remember { mutableStateOf("") }
  // Debounced query: results only compute once the user pauses typing.
  var debouncedQ by remember { mutableStateOf("") }
  LaunchedEffect(Unit) { vm.load() }
  LaunchedEffect(q) {
    if (q.isBlank()) debouncedQ = ""
    else { kotlinx.coroutines.delay(400); debouncedQ = q }
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Address Book", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    OutlinedTextField(
      value = q, onValueChange = { q = it },
      placeholder = { Text("Search name, ID, department or designation") },
      leadingIcon = { Icon(Icons.Filled.Search, null, tint = Green) },
      singleLine = true, shape = RoundedCornerShape(14.dp),
      colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
      modifier = Modifier.fillMaxWidth().padding(14.dp),
    )
    when {
      // Directory is private by default — results appear only after the user searches.
      q.isBlank() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
          Icon(Icons.Filled.Search, null, tint = InkFaint, modifier = Modifier.size(40.dp))
          Spacer(Modifier.height(10.dp))
          Text("Search by name, employee ID, department\nor designation to find a colleague.", color = InkSoft, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
      }
      // Still typing — hold the list back until the user pauses.
      debouncedQ != q -> Box(Modifier.fillMaxSize())
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load() })
      else -> {
        // E56: trimmed; matches name, ID, department and designation.
        val filtered = (s.data ?: emptyList()).filter {
          com.truehr.app.core.Validators.directoryMatches(debouncedQ, it.name, it.employeeCode, it.department, it.designation)
        }
        if (filtered.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          Text("No matches.", color = InkSoft)
        } else {
          // Group by work location (blank -> "Other")
          val groups = filtered.groupBy { it.location?.trim()?.takeIf { s -> s.isNotBlank() } ?: "Other" }
            .toSortedMap(compareBy { if (it == "Other") "~" else it.lowercase() })
          LazyColumn(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            groups.forEach { (state, people) ->
              item {
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
        com.truehr.app.presentation.components.EmployeePhoto(m.id, m.name, 44.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
          Text(m.name, fontWeight = FontWeight.Bold, color = Ink)
          Text("${m.employeeCode}  ·  ${m.designation ?: "—"}", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
          if (!m.department.isNullOrBlank()) Text(m.department, color = InkSoft, style = MaterialTheme.typography.labelMedium)
        }
      }
      // E54: official email only — personal phone numbers are not shown.
      if (!m.email.isNullOrBlank()) {
        Spacer(Modifier.height(8.dp))
        ContactLine(Icons.Filled.Mail, m.email)
      }
    }
  }
}

@Composable
private fun ContactLine(icon: ImageVector, value: String) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Icon(icon, null, tint = InkFaint, modifier = Modifier.size(14.dp))
    Spacer(Modifier.width(8.dp))
    // E55: one unbroken line so a "+alias" address is never split visually.
    Text(value, color = InkSoft, style = MaterialTheme.typography.bodyMedium, softWrap = false,
      overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, maxLines = 1)
  }
}

