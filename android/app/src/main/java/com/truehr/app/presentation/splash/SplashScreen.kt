package com.truehr.app.presentation.splash

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.res.painterResource
import com.truehr.app.R
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first

@Composable
fun SplashScreen(onLoggedIn: () -> Unit, onGuest: () -> Unit, vm: SplashViewModel = hiltViewModel()) {
  LaunchedEffect(Unit) {
    delay(900)
    if (vm.isLoggedIn.first()) onLoggedIn() else onGuest()
  }
  Box(Modifier.fillMaxSize().background(Canvas), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
      Image(painterResource(R.drawable.tkf_logo), contentDescription = "True Kind Foundation", modifier = Modifier.size(110.dp).clip(CircleShape))
      Spacer(Modifier.height(18.dp))
      Row {
        Text("TRUE ", style = MaterialTheme.typography.headlineSmall, color = Green, fontWeight = FontWeight.Black)
        Text("KIND", style = MaterialTheme.typography.headlineSmall, color = Teal, fontWeight = FontWeight.Black)
      }
      Text("Employee Self Service App", color = InkSoft)
    }
  }
}
