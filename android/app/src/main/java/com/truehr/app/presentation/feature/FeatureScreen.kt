package com.truehr.app.presentation.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Construction
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.theme.*

/** Polished placeholder for modules whose backend endpoints are not built yet. */
@Composable
fun FeatureScreen(title: String, onBack: () -> Unit) {
  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text(title, color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
      Box(Modifier.size(76.dp).clip(CircleShape).background(Green.copy(alpha = 0.10f)), contentAlignment = Alignment.Center) {
        Icon(Icons.Filled.Construction, null, tint = Green, modifier = Modifier.size(38.dp))
      }
      Spacer(Modifier.height(16.dp))
      Text(title, style = MaterialTheme.typography.titleMedium, color = Ink)
      Spacer(Modifier.height(6.dp))
      Text("This module is coming soon. The screen and navigation are ready; it will activate once its API is connected.",
        color = InkSoft, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
    }
  }
}
