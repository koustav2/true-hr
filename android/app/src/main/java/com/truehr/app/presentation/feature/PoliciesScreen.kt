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
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Download
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
import com.truehr.app.presentation.components.initials
import com.truehr.app.presentation.profile.ProfileViewModel
import com.truehr.app.presentation.theme.*
import java.io.File

@Composable
fun PoliciesScreen(onBack: () -> Unit, vm: PolicyViewModel = hiltViewModel(), profileVm: ProfileViewModel = hiltViewModel()) {
  val context = LocalContext.current
  val s by vm.list.collectAsState()
  val prof by profileVm.state.collectAsState()
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
      Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
          IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
          Text("Policies", color = Surface, style = MaterialTheme.typography.titleLarge)
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
          Box(Modifier.size(46.dp).clip(CircleShape).background(Surface.copy(alpha = 0.25f)), contentAlignment = Alignment.Center) {
            Text(initials(prof.data?.fullName ?: "?"), color = Surface, fontWeight = FontWeight.Bold)
          }
          Spacer(Modifier.width(12.dp))
          Column {
            Text(prof.data?.fullName ?: "—", color = Surface, fontWeight = FontWeight.Bold)
            Text(prof.data?.designation ?: "", color = Surface.copy(alpha = 0.9f), style = MaterialTheme.typography.bodyMedium)
          }
        }
      }
    }
    when {
      s.loading -> CenterLoader()
      s.error != null -> ErrorState(s.error!!, onRetry = { vm.load() })
      s.data.isNullOrEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("No policies available yet.", color = InkSoft) }
      else -> LazyColumn(contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(s.data!!) { p -> PolicyCard(p, busy = opening != null && opening == p.id, onOpen = { vm.open(p) }) }
      }
    }
  }
}

@Composable
private fun PolicyCard(p: Policy, busy: Boolean, onOpen: () -> Unit) {
  val tint = if (p.available) Green else InkFaint
  Surface(color = Surface, shape = RoundedCornerShape(14.dp), shadowElevation = 2.dp,
    modifier = Modifier.clickable(enabled = p.available && !busy, onClick = onOpen)) {
    Row(Modifier.padding(horizontal = 16.dp, vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
      Icon(Icons.Filled.Description, null, tint = tint, modifier = Modifier.size(22.dp))
      Spacer(Modifier.width(14.dp))
      Column(Modifier.weight(1f)) {
        Text(p.title, fontWeight = FontWeight.SemiBold, color = Ink)
        if (!p.available) Text("Not uploaded yet", color = InkFaint, style = MaterialTheme.typography.labelSmall)
      }
      if (busy) {
        CircularProgressIndicator(color = Green, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
      } else {
        Icon(Icons.Filled.Download, null, tint = tint, modifier = Modifier.size(22.dp))
      }
      Spacer(Modifier.width(10.dp))
      Icon(Icons.Filled.ChevronRight, null, tint = InkFaint, modifier = Modifier.size(20.dp))
    }
  }
}
