package com.truehr.app.presentation.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.truehr.app.presentation.components.AppTextField
import com.truehr.app.presentation.components.PrimaryButton
import com.truehr.app.presentation.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChangePasswordScreen(onDone: () -> Unit, onBack: () -> Unit, vm: ChangePasswordViewModel = hiltViewModel()) {
  val s by vm.state.collectAsState()
  LaunchedEffect(s.done) { if (s.done) onDone() }
  Scaffold(
    topBar = {
      TopAppBar(
        title = { Text("Change Password") },
        navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Green, titleContentColor = Surface, navigationIconContentColor = Surface),
      )
    },
    containerColor = Canvas,
  ) { pad ->
    Column(Modifier.padding(pad).padding(24.dp)) {
      AppTextField(s.current, vm::onCurrent, "Current password", visualTransformation = PasswordVisualTransformation())
      Spacer(Modifier.height(16.dp))
      AppTextField(s.next, vm::onNext, "New password", visualTransformation = PasswordVisualTransformation())
      Spacer(Modifier.height(16.dp))
      AppTextField(s.confirm, vm::onConfirm, "Confirm new password", visualTransformation = PasswordVisualTransformation())
      s.error?.let { Spacer(Modifier.height(10.dp)); Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
      Spacer(Modifier.height(24.dp))
      PrimaryButton(if (s.loading) "" else "Update password", loading = s.loading, onClick = vm::submit, modifier = Modifier.fillMaxWidth())
    }
  }
}
