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
    else { kotlinx.coroutines.delay(600); debouncedQ = q }
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
      placeholder = { Text("Please type employee id or name to search") },
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
          Text("Search by employee ID or name\nto find a colleague.", color = InkSoft, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
      }
      // Still typing — hold the list back until the user pauses.
      debouncedQ != q -> Box(Modifier.fillMaxSize())
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load() })
      else -> {
        val filtered = (s.data ?: emptyList()).filter {
          matchesQuery("${it.name} ${it.employeeCode}", debouncedQ)
        }
        if (filtered.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
          Text("No employees found.", color = InkSoft)
        } else {
          // Group by state (blank -> "Other")
          val groups = filtered.groupBy { it.state?.trim()?.takeIf { s -> s.isNotBlank() } ?: "Other" }
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

/**
 * Comma-separated, fuzzy search. The query is split on commas into terms; an entry
 * matches only if EVERY term matches somewhere in its text. Each term matches by
 * substring OR a typo-tolerant (edit-distance) match against any word.
 * Matching runs over the employee's name and employee code only;
 * e.g. "sharma" or "TKF5001" — "sharme" still hits "sharma" (typo-tolerant).
 */
private fun matchesQuery(haystack: String, query: String): Boolean {
  val terms = query.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }
  if (terms.isEmpty()) return true
  val hay = haystack.lowercase()
  val tokens = hay.split(' ', ',', '·', '.', '-', '/').filter { it.isNotBlank() }
  return terms.all { term ->
    hay.contains(term) || tokens.any { fuzzyWord(it, term) }
  }
}

private fun fuzzyWord(token: String, term: String): Boolean {
  if (token.contains(term) || term.contains(token)) return true
  if (term.length < 3) return token.startsWith(term)
  // People usually type the start of a name right: a shared prefix of 4+ letters
  // covering at least half the query counts (e.g. "nishiiikaa" → "nishikanta").
  val prefix = token.commonPrefixWith(term).length
  if (prefix >= 4 && prefix * 2 >= term.length) return true
  // Otherwise allow typos scaled to word length (~1 per 3 letters).
  val maxDist = maxOf(1, term.length / 3)
  return levenshtein(token, term) <= maxDist
}

private fun levenshtein(a: String, b: String): Int {
  if (a == b) return 0
  if (a.isEmpty()) return b.length
  if (b.isEmpty()) return a.length
  var prev = IntArray(b.length + 1) { it }
  var curr = IntArray(b.length + 1)
  for (i in 1..a.length) {
    curr[0] = i
    for (j in 1..b.length) {
      val cost = if (a[i - 1] == b[j - 1]) 0 else 1
      curr[j] = minOf(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    val tmp = prev; prev = curr; curr = tmp
  }
  return prev[b.length]
}
