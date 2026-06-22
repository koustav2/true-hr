package com.truehr.app.presentation.feature

import android.content.Intent
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.domain.model.Policy
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.ErrorState
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*
import java.io.File

@Composable
fun PoliciesScreen(onBack: () -> Unit, vm: PolicyViewModel = hiltViewModel()) {
  val context = LocalContext.current
  val s by vm.list.collectAsState()
  val opening by vm.opening.collectAsState()
  val openFile by vm.openFile.collectAsState()
  val openError by vm.openError.collectAsState()

  LaunchedEffect(Unit) { vm.load() }
  LaunchedEffect(openError) { openError?.let { Toast.makeText(context, it, Toast.LENGTH_SHORT).show() } }

  // When a file is downloaded, write it to cache and open with an external viewer.
  LaunchedEffect(openFile) {
    openFile?.let { f ->
      try {
        val dir = File(context.cacheDir, "policies").apply { mkdirs() }
        val safe = f.filename.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val out = File(dir, safe)
        out.writeBytes(f.bytes)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", out)
        val intent = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, f.mime)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      } catch (e: Exception) {
        Toast.makeText(context, "No app to open this file type.", Toast.LENGTH_SHORT).show()
      } finally { vm.consumeOpen() }
    }
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Policies", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load() })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No policies available yet.", color = InkSoft) }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(s.data!!) { p -> PolicyCard(p, busy = opening == p.id, onOpen = { vm.open(p) }) }
      }
    }
  }
}

@Composable
private fun PolicyCard(p: Policy, busy: Boolean, onOpen: () -> Unit) {
  Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 1.dp,
    border = androidx.compose.foundation.BorderStroke(1.dp, Line),
    modifier = Modifier.clickable(enabled = !busy, onClick = onOpen)) {
    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
      Box(Modifier.size(44.dp).clip(CircleShape).background(Green.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.Description, null, tint = Green, modifier = Modifier.size(22.dp))
      }
      Spacer(Modifier.width(12.dp))
      Column(Modifier.weight(1f)) {
        Text(p.title, fontWeight = FontWeight.Bold, color = Ink)
        Text(listOfNotNull(p.category, p.uploadedAt?.take(10)).joinToString("  ·  ").ifBlank { "Document" },
          color = InkFaint, style = MaterialTheme.typography.bodyMedium)
      }
      if (busy) CircularProgressIndicator(color = Green, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
      else Icon(Icons.Filled.OpenInNew, null, tint = Green, modifier = Modifier.size(20.dp))
    }
  }
}
