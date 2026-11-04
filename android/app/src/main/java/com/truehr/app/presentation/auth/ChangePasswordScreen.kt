package com.truehr.app.presentation.auth

import android.widget.Toast
import androidx.activity.compose.BackHandler
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
import com.truehr.app.presentation.components.FieldError
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.PrimaryButton
import com.truehr.app.presentation.theme.*

@Composable
fun ChangePasswordScreen(
  forced: Boolean,
  onDone: () -> Unit,
  onBack: () -> Unit,
  onSignedOut: () -> Unit,
  vm: ChangePasswordViewModel = hiltViewModel(),
) {
  val s by vm.state.collectAsState()
  val ctx = LocalContext.current
  var showCur by remember { mutableStateOf(false) }
  var showNew by remember { mutableStateOf(false) }
  var showCon by remember { mutableStateOf(false) }
  var askSignOut by remember { mutableStateOf(false) }

  LaunchedEffect(s.done) {
    if (s.done) { Toast.makeText(ctx, "Password updated successfully", Toast.LENGTH_SHORT).show(); onDone() }
  }
  LaunchedEffect(s.signedOut) { if (s.signedOut) onSignedOut() }
  // On the forced change, Back does not skip it: it offers to sign out instead.
  BackHandler(enabled = forced) { askSignOut = true }

  if (askSignOut) {
    AlertDialog(
      onDismissRequest = { askSignOut = false },
      title = { Text("Sign out?") },
      text = { Text("You need to set a new password before using the app. Sign out instead?") },
      confirmButton = { TextButton(onClick = { askSignOut = false; vm.signOut() }) { Text("Sign out", color = Rose) } },
      dismissButton = { TextButton(onClick = { askSignOut = false }) { Text("Stay") } },
    )
  }

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { if (forced) askSignOut = true else onBack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text(if (forced) "Set a new password" else "Change Password", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
      Surface(color = Surface, shape = RoundedCornerShape(16.dp), shadowElevation = 2.dp) {
        Column(Modifier.padding(18.dp)) {
          Text(if (forced) "Your password was set by HR" else "Update your password", fontWeight = FontWeight.Bold, color = Ink, style = MaterialTheme.typography.titleMedium)
          Text(
            if (forced) "Choose your own password to continue. Use at least 8 characters with a letter and a digit."
            else "Use at least 8 characters with at least one letter and one digit.",
            color = InkFaint, style = MaterialTheme.typography.bodyMedium,
          )
          Spacer(Modifier.height(16.dp))

          if (!forced) {
            PwField(s.current, vm::onCurrent, "Current password", showCur) { showCur = !showCur }
            FieldError(s.fields["currentPassword"])
            Spacer(Modifier.height(14.dp))
          }
          PwField(s.next, vm::onNext, "New password", showNew) { showNew = !showNew }
          FieldError(s.fields["newPassword"])
          Spacer(Modifier.height(14.dp))
          PwField(s.confirm, vm::onConfirm, "Confirm new password", showCon) { showCon = !showCon }
          FieldError(s.fields["confirm"])

          s.error?.let { Spacer(Modifier.height(12.dp)); Text(it, color = Rose, style = MaterialTheme.typography.bodyMedium) }
          Spacer(Modifier.height(22.dp))
          PrimaryButton(if (s.loading) "" else "Update Password", loading = s.loading, onClick = { vm.submit(forced) }, modifier = Modifier.fillMaxWidth())
          if (forced) {
            Spacer(Modifier.height(8.dp))
            TextButton(onClick = { askSignOut = true }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text("Sign out", color = InkSoft) }
          }
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
        Icon(if (show) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, contentDescription = if (show) "Hide password" else "Show password", tint = InkFaint)
      }
    },
  )
}
