package com.truehr.app.presentation.auth

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.R
import com.truehr.app.presentation.components.AppTextField
import com.truehr.app.presentation.components.PrimaryButton
import com.truehr.app.presentation.theme.*

@Composable
fun LoginScreen(onLoggedIn: () -> Unit, onMustChange: () -> Unit, onForgotPassword: () -> Unit = {}, vm: LoginViewModel = hiltViewModel()) {
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
    Modifier
      .fillMaxSize()
      .background(Canvas)
      .verticalScroll(rememberScrollState()),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    // Brand hero on the executive navy gradient.
    Box(
      modifier = Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(bottomStart = 32.dp, bottomEnd = 32.dp))
        .background(Brush.linearGradient(listOf(Navy, NavyMid, NavyBright))),
    ) {
      Box(Modifier.size(200.dp).offset(x = (-70).dp, y = (-80).dp).clip(CircleShape).background(Color.White.copy(alpha = 0.05f)))
      Box(Modifier.size(160.dp).align(Alignment.TopEnd).offset(x = 50.dp, y = (-30).dp).clip(CircleShape).background(Color.White.copy(alpha = 0.06f)))
      Column(
        modifier = Modifier
          .fillMaxWidth()
          .statusBarsPadding()
          .padding(top = 36.dp, bottom = 52.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
      ) {
        Box(
          modifier = Modifier
            .size(98.dp)
            .clip(CircleShape)
            .border(2.dp, Color.White.copy(alpha = 0.35f), CircleShape)
            .background(Surface),
          contentAlignment = Alignment.Center,
        ) {
          Image(
            painterResource(R.drawable.tkf_logo),
            contentDescription = "True Kind Foundation",
            modifier = Modifier.size(92.dp).clip(CircleShape),
          )
        }
        Spacer(Modifier.height(16.dp))
        Row {
          Text("TRUE ", style = MaterialTheme.typography.headlineSmall, color = Surface, fontWeight = FontWeight.Black)
          Text("KIND", style = MaterialTheme.typography.headlineSmall, color = Color(0xFF6EE7A0), fontWeight = FontWeight.Black)
        }
        Spacer(Modifier.height(4.dp))
        Text(
          "EMPLOYEE SELF SERVICE",
          color = Surface.copy(alpha = 0.7f),
          style = MaterialTheme.typography.labelSmall,
          letterSpacing = 2.2.sp,
        )
      }
    }

    // Sign-in card overlapping the hero.
    Surface(
      color = Surface,
      shape = RoundedCornerShape(24.dp),
      border = BorderStroke(1.dp, Line),
      shadowElevation = 8.dp,
      modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 20.dp)
        .offset(y = (-30).dp),
    ) {
      Column(Modifier.padding(horizontal = 22.dp, vertical = 26.dp)) {
        if (s.otpStage) {
          // Two-step login: enter the code that was emailed after the password.
          Text("Check your email", style = MaterialTheme.typography.headlineSmall, color = Ink)
          Spacer(Modifier.height(3.dp))
          Text(
            "We emailed a 6-digit sign-in code to ${s.maskedEmail ?: "your email"}. It expires in 10 minutes.",
            style = MaterialTheme.typography.bodyMedium, color = InkSoft,
          )
          Spacer(Modifier.height(22.dp))
          AppTextField(
            s.otp, vm::onOtp, "6-digit code",
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
              keyboardType = androidx.compose.ui.text.input.KeyboardType.NumberPassword,
            ),
          )
          s.error?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium)
          }
          s.info?.let {
            Spacer(Modifier.height(10.dp))
            Text(it, color = Green, style = MaterialTheme.typography.bodyMedium)
          }
          Spacer(Modifier.height(16.dp))
          PrimaryButton(if (s.loading) "" else "Verify & Sign In", loading = s.loading, onClick = vm::verifyOtp, modifier = Modifier.fillMaxWidth())
          Spacer(Modifier.height(6.dp))
          Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = vm::backToPassword, contentPadding = PaddingValues(horizontal = 4.dp)) {
              Text("Back", color = InkFaint, style = MaterialTheme.typography.labelLarge)
            }
            TextButton(onClick = { vm.login(resend = true) }, enabled = !s.loading, contentPadding = PaddingValues(horizontal = 4.dp)) {
              Text("Resend code", color = Green, style = MaterialTheme.typography.labelLarge)
            }
          }
        } else {
          Text("Welcome back", style = MaterialTheme.typography.headlineSmall, color = Ink)
          Spacer(Modifier.height(3.dp))
          Text("Sign in to your account to continue", style = MaterialTheme.typography.bodyMedium, color = InkSoft)
          Spacer(Modifier.height(22.dp))

          AppTextField(s.email, vm::onEmail, "Username")
          Spacer(Modifier.height(14.dp))
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
            Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium)
          }
          Spacer(Modifier.height(6.dp))
          TextButton(onClick = onForgotPassword, modifier = Modifier.align(Alignment.End), contentPadding = PaddingValues(horizontal = 4.dp)) {
            Text("Forgot Password?", color = Green, style = MaterialTheme.typography.labelLarge)
          }
          Spacer(Modifier.height(10.dp))
          PrimaryButton(if (s.loading) "" else "Sign In", loading = s.loading, onClick = { vm.login() }, modifier = Modifier.fillMaxWidth())
        }
      }
    }

    Spacer(Modifier.height(6.dp))
    val context = LocalContext.current
    fun open(url: String) = runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    Row(verticalAlignment = Alignment.CenterVertically) {
      TextButton(onClick = { open("https://truehr.co.in/privacy") }) { Text("Privacy Policy", color = InkFaint, style = MaterialTheme.typography.labelMedium) }
      Text("·", color = InkFaint)
      TextButton(onClick = { open("https://truehr.co.in/terms") }) { Text("Terms & Conditions", color = InkFaint, style = MaterialTheme.typography.labelMedium) }
    }
    Spacer(Modifier.height(10.dp))
    Spacer(Modifier.navigationBarsPadding())
  }
}
