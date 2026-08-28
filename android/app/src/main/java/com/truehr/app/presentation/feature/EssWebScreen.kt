package com.truehr.app.presentation.feature

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Language
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.BuildConfig
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.repository.EssRepository
import com.truehr.app.presentation.components.CenterLoader
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.PrimaryButton
import com.truehr.app.presentation.theme.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EssWebViewModel @Inject constructor(
  private val repo: EssRepository,
) : ViewModel() {
  val url = MutableStateFlow<String?>(null)
  val error = MutableStateFlow<String?>(null)
  val loading = MutableStateFlow(false)

  // Fetch a 60s handoff token and build the tokenized web link (GreenHR-style).
  fun prepare(section: String = "") = viewModelScope.launch {
    loading.value = true; error.value = null; url.value = null
    try {
      val next = if (section.isNotBlank()) "&next=/ess/$section" else ""
      url.value = "${BuildConfig.WEB_URL}/sso?t=${repo.webSsoToken()}$next"
    }
    catch (e: Exception) { error.value = e.apiMessage("Could not open the employee portal") }
    finally { loading.value = false }
  }
}

// "My ESS" — opens the TrueHR web portal in the browser, already signed in.
// NFA, settlements, performance, vendors and agreements all live on the web.
@Composable
fun EssWebScreen(section: String = "", onBack: () -> Unit, vm: EssWebViewModel = hiltViewModel()) {
  val ctx = LocalContext.current
  val url by vm.url.collectAsState()
  val error by vm.error.collectAsState()
  val loading by vm.loading.collectAsState()

  LaunchedEffect(Unit) { vm.prepare(section) }
  // As soon as the tokenized link is ready, hand off to the browser.
  LaunchedEffect(url) {
    url?.let {
      ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(it)))
      onBack()
    }
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("My ESS", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    when {
      loading -> CenterLoader()
      error != null -> Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
      ) {
        Icon(Icons.Filled.Language, null, tint = InkFaint, modifier = Modifier.size(48.dp))
        Spacer(Modifier.height(12.dp))
        Text("Could not open the employee portal", fontWeight = FontWeight.Bold, color = Ink, textAlign = TextAlign.Center)
        Spacer(Modifier.height(4.dp))
        Text(error!!, color = InkSoft, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        PrimaryButton("Try again", onClick = { vm.prepare() })
      }
      else -> Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
      ) {
        Text("Opening the employee portal in your browser…", color = InkSoft, textAlign = TextAlign.Center)
      }
    }
  }
}
