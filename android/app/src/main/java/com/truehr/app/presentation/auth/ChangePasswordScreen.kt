package com.truehr.app.presentation.auth

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.AppTextField
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.PrimaryButton
import com.truehr.app.presentation.theme.*

@Composable
fun ChangePasswordScreen(onDone: () -> Unit, onBack: () -> Unit, vm: ChangePasswordViewModel = hiltViewModel()) {
  val s by vm.state.collectAsState()
  val ctx = LocalContext.current
  var showNew by remember { mutableStateOf(false) }
  var showCon by remember { mutableStateOf(false) }

  LaunchedEffect(s.done) {
    if (s.done) { Toast.makeText(ctx, "Password updated successfully", Toast.LENGTH_SHORT).show(); onDone() }
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Change Password", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
      Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 2.dp) {
        Column(Modifier.padding(18.dp)) {
          Text("Update your password", fontWeight = FontWeight.Bold, color = Ink, style = MaterialTheme.typography.titleMedium)
          Text("Use at least 8 characters. Choose something you don't use elsewhere.", color = InkFaint, style = MaterialTheme.typography.bodyMedium)
          Spacer(Modifier.height(16.dp))

          PwField(s.next, vm::onNext, "New password", showNew) { showNew = !showNew }
          Spacer(Modifier.height(14.dp))
          PwField(s.confirm, vm::onConfirm, "Confirm new password", showCon) { showCon = !showCon }

          s.error?.let { Spacer(Modifier.height(12.dp)); Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
          Spacer(Modifier.height(22.dp))
          PrimaryButton(if (s.loading) "" else "Update Password", loading = s.loading, onClick = vm::submit, modifier = Modifier.fillMaxWidth())
        }
      }
      Spacer(Modifier.height(12.dp))
    }
  }
}

@Composable
private fun PwField(value: String, onChange: (String) -> Unit, label: String, show: Boolean, onToggle: () -> Unit) {
  AppTextField(
    value, onChange, label,
    visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
    trailing = {
      IconButton(onClick = onToggle) {
        Icon(if (show) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, contentDescription = null, tint = InkFaint)
      }
    },
  )
}
