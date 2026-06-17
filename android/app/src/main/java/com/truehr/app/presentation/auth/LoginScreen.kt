package com.truehr.app.presentation.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.AppTextField
import com.truehr.app.presentation.components.PrimaryButton
import com.truehr.app.presentation.theme.*

@Composable
fun LoginScreen(onLoggedIn: () -> Unit, onMustChange: () -> Unit, vm: LoginViewModel = hiltViewModel()) {
  val s by vm.state.collectAsState()
  val event by vm.event.collectAsState()

  LaunchedEffect(event) {
    when (event) {
      LoginEvent.GoHome -> { vm.consumeEvent(); onLoggedIn() }
      LoginEvent.MustChangePassword -> { vm.consumeEvent(); onMustChange() }
      null -> {}
    }
  }

  Column(
    Modifier.fillMaxSize().background(Canvas).statusBarsPadding().padding(24.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Spacer(Modifier.height(40.dp))
    Row {
      Text("TRUE ", style = MaterialTheme.typography.headlineSmall, color = Green, fontWeight = FontWeight.Black)
      Text("KIND", style = MaterialTheme.typography.headlineSmall, color = Teal, fontWeight = FontWeight.Black)
    }
    Text("Sign In", style = MaterialTheme.typography.titleLarge, color = Ink, modifier = Modifier.padding(top = 6.dp))
    Spacer(Modifier.height(36.dp))

    AppTextField(s.email, vm::onEmail, "Username")
    Spacer(Modifier.height(16.dp))
    AppTextField(
      s.password, vm::onPassword, "Password",
      visualTransformation = if (s.showPassword) VisualTransformation.None else PasswordVisualTransformation(),
      trailing = {
        IconButton(onClick = vm::toggleShow) {
          Icon(if (s.showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, contentDescription = null, tint = InkFaint)
        }
      },
    )
    s.error?.let {
      Spacer(Modifier.height(10.dp))
      Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.align(Alignment.Start))
    }
    Spacer(Modifier.height(24.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
      TextButton(onClick = {}) { Text("Forgot Password?", color = Green) }
      PrimaryButton(if (s.loading) "" else "Login", loading = s.loading, onClick = vm::login, modifier = Modifier.width(150.dp))
    }
  }
}
