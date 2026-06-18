package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import com.truehr.app.domain.model.TeamMate
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.initials
import com.truehr.app.presentation.theme.*

@Composable
fun TeamListScreen(onBack: () -> Unit, vm: TeamListViewModel = hiltViewModel()) {
  val s by vm.list.collectAsState()
  var q by remember { mutableStateOf("") }
  LaunchedEffect(Unit) { vm.load() }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Column {
          Text("Team List", color = Surface, style = MaterialTheme.typography.titleLarge)
          val n = s.data?.size
          if (n != null) Text("$n ${if (n == 1) "member" else "members"} reporting to you", color = Surface.copy(alpha = 0.9f), style = MaterialTheme.typography.bodyMedium)
        }
      }
    }
    OutlinedTextField(
      value = q, onValueChange = { q = it },
      placeholder = { Text("Search name, ID, designation…") },
      leadingIcon = { Icon(Icons.Filled.Search, null, tint = Green) },
      singleLine = true, shape = RoundedCornerShape(14.dp),
      colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Green),
      modifier = Modifier.fillMaxWidth().padding(14.dp),
    )
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load() })
      else -> {
        val list = (s.data ?: emptyList()).filter {
          q.isBlank() || "${it.name} ${it.employeeCode} ${it.designation} ${it.department}".contains(q, ignoreCase = true)
        }
        if (list.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          Text("No team members under you.", color = InkSoft)
        } else LazyColumn(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
          items(list) { TeamMateCard(it) }
        }
      }
    }
  }
}

@Composable
private fun TeamMateCard(m: TeamMate) {
  Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp, border = androidx.compose.foundation.BorderStroke(1.dp, Line)) {
    Column(Modifier.padding(16.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(46.dp).clip(CircleShape).background(Green.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
          Text(initials(m.name), color = Green, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
          Text(m.name, fontWeight = FontWeight.Bold, color = Ink)
          Text("${m.employeeCode}  ·  ${m.designation ?: "—"}", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
          if (!m.department.isNullOrBlank()) Text(m.department, color = InkSoft, style = MaterialTheme.typography.labelMedium)
        }
      }
      if (!m.email.isNullOrBlank() || !m.phone.isNullOrBlank()) {
        Spacer(Modifier.height(10.dp))
        HorizontalDivider(color = Line)
        Spacer(Modifier.height(10.dp))
        if (!m.email.isNullOrBlank()) ContactRow(Icons.Filled.Mail, m.email)
        if (!m.phone.isNullOrBlank()) { Spacer(Modifier.height(6.dp)); ContactRow(Icons.Filled.Phone, m.phone) }
      }
    }
  }
}

@Composable
private fun ContactRow(icon: ImageVector, value: String) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Icon(icon, null, tint = InkFaint, modifier = Modifier.size(15.dp))
    Spacer(Modifier.width(8.dp))
    Text(value, color = InkSoft, style = MaterialTheme.typography.bodyMedium)
  }
}
