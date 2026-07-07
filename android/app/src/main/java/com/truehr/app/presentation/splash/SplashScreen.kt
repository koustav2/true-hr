package com.truehr.app.presentation.splash

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.R
import com.truehr.app.presentation.theme.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first

@Composable
fun SplashScreen(onLoggedIn: () -> Unit, onGuest: () -> Unit, vm: SplashViewModel = hiltViewModel()) {
  var visible by remember { mutableStateOf(false) }
  val alpha by animateFloatAsState(if (visible) 1f else 0f, tween(700), label = "splash-fade")

  LaunchedEffect(Unit) {
    visible = true
    delay(1100)
    if (vm.isLoggedIn.first()) onLoggedIn() else onGuest()
  }

  Box(
    modifier = Modifier
      .fillMaxSize()
      .background(Brush.verticalGradient(listOf(Navy, NavyMid, NavyBright))),
  ) {
    Box(Modifier.size(240.dp).offset(x = (-80).dp, y = (-60).dp).clip(CircleShape).background(Color.White.copy(alpha = 0.05f)))
    Box(Modifier.size(200.dp).align(Alignment.BottomEnd).offset(x = 70.dp, y = 60.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.05f)))

    Column(
      modifier = Modifier.align(Alignment.Center).alpha(alpha),
      horizontalAlignment = Alignment.CenterHorizontally,
    ) {
      Box(
        modifier = Modifier
          .size(118.dp)
          .clip(CircleShape)
          .border(2.dp, Color.White.copy(alpha = 0.35f), CircleShape)
          .background(Surface),
        contentAlignment = Alignment.Center,
      ) {
        Image(
          painterResource(R.drawable.tkf_logo),
          contentDescription = "True Kind Foundation",
          modifier = Modifier.size(110.dp).clip(CircleShape),
        )
      }
      Spacer(Modifier.height(20.dp))
      Row {
        Text("TRUE ", style = MaterialTheme.typography.headlineSmall, color = Surface, fontWeight = FontWeight.Black)
        Text("KIND", style = MaterialTheme.typography.headlineSmall, color = Color(0xFF6EE7A0), fontWeight = FontWeight.Black)
      }
      Spacer(Modifier.height(6.dp))
      Text(
        "EMPLOYEE SELF SERVICE",
        color = Surface.copy(alpha = 0.7f),
        style = MaterialTheme.typography.labelSmall,
        letterSpacing = 2.2.sp,
      )
    }

    Text(
      "Powered by TrueHR",
      color = Surface.copy(alpha = 0.45f),
      style = MaterialTheme.typography.labelSmall,
      modifier = Modifier
        .align(Alignment.BottomCenter)
        .navigationBarsPadding()
        .padding(bottom = 22.dp)
        .alpha(alpha),
    )
  }
}
