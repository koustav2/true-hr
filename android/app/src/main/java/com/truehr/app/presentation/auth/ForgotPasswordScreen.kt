package com.truehr.app.presentation.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.repository.AuthRepository
import com.truehr.app.presentation.components.AppTextField
import com.truehr.app.presentation.components.GradientHeader
import com.truehr.app.presentation.components.InfoCard
import com.truehr.app.presentation.components.PrimaryButton
import com.truehr.app.presentation.theme.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ForgotState(
  val step: Int = 1,                 // 1 = enter email, 2 = enter OTP + new password
  val email: String = "",
  val otp: String = "",
  val newPassword: String = "",
  val confirmPassword: String = "",
  val showPassword: Boolean = false,
  val loading: Boolean = false,
  val error: String? = null,
  val done: Boolean = false,
)

@HiltViewModel
class ForgotPasswordViewModel @Inject constructor(
  private val authRepository: AuthRepository,
) : ViewModel() {
  private val _state = MutableStateFlow(ForgotState())
  val state = _state.asStateFlow()

  fun onEmail(v: String) = _state.update { it.copy(email = v, error = null) }
  fun onOtp(v: String) = _state.update { it.copy(otp = v.filter { c -> c.isDigit() }.take(6), error = null) }
  fun onNewPassword(v: String) = _state.update { it.copy(newPassword = v, error = null) }
  fun onConfirmPassword(v: String) = _state.update { it.copy(confirmPassword = v, error = null) }
  fun toggleShow() = _state.update { it.copy(showPassword = !it.showPassword) }
  fun backToEmail() = _state.update { it.copy(step = 1, otp = "", error = null) }

  fun sendOtp() {
    val s = _state.value
    if (s.email.isBlank()) { _state.update { it.copy(error = "Enter your email or Employee ID") }; return }
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      try {
        authRepository.forgotPassword(s.email)
        _state.update { it.copy(loading = false, step = 2) }
      } catch (e: Exception) {
        _state.update { it.copy(loading = false, error = e.apiMessage()) }
      }
    }
  }

  fun reset() {
    val s = _state.value
    val error = when {
      s.otp.length != 6 -> "Enter the 6-digit code from the email"
      s.newPassword.length < 8 -> "Password must be at least 8 characters"
      s.newPassword != s.confirmPassword -> "Passwords do not match"
      else -> null
    }
    if (error != null) { _state.update { it.copy(error = error) }; return }
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      try {
        authRepository.resetPassword(s.email, s.otp, s.newPassword)
        _state.update { it.copy(loading = false, done = true) }
      } catch (e: Exception) {
        _state.update { it.copy(loading = false, error = e.apiMessage()) }
      }
    }
  }
}

@Composable
fun ForgotPasswordScreen(onBack: () -> Unit, vm: ForgotPasswordViewModel = hiltViewModel()) {
  val s by vm.state.collectAsState()

  Column(Modifier.fillMaxSize().background(Canvas)) {
    GradientHeader {
      Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = Surface) }
        Text("Forgot Password", color = Surface, style = MaterialTheme.typography.titleLarge)
      }
    }
    Column(
      Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
      when {
        s.done -> InfoCard {
          Text("Password reset", fontWeight = FontWeight.Bold, color = Ink)
          Spacer(Modifier.height(6.dp))
          Text("Your password has been changed. Sign in with your new password.", color = InkSoft, style = MaterialTheme.typography.bodyMedium)
          Spacer(Modifier.height(14.dp))
          PrimaryButton("Back to Sign In", onClick = onBack, modifier = Modifier.fillMaxWidth())
        }

        s.step == 1 -> InfoCard {
          Text("Reset your password", fontWeight = FontWeight.Bold, color = Ink)
          Spacer(Modifier.height(6.dp))
          Text("Enter your official email or Employee ID and we'll send a 6-digit code to your registered email.", color = InkSoft, style = MaterialTheme.typography.bodyMedium)
          Spacer(Modifier.height(14.dp))
          AppTextField(s.email, vm::onEmail, "Email or Employee ID")
          s.error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = Rose, style = MaterialTheme.typography.bodySmall) }
          Spacer(Modifier.height(14.dp))
          PrimaryButton(if (s.loading) "" else "Send Code", loading = s.loading, onClick = vm::sendOtp, modifier = Modifier.fillMaxWidth())
        }

        else -> InfoCard {
          Text("Enter the code", fontWeight = FontWeight.Bold, color = Ink)
          Spacer(Modifier.height(6.dp))
          Text("We emailed a 6-digit code to the address registered for “${s.email}”. It expires in 10 minutes.", color = InkSoft, style = MaterialTheme.typography.bodyMedium)
          Spacer(Modifier.height(14.dp))
          AppTextField(
            s.otp, vm::onOtp, "6-digit code",
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
          )
          Spacer(Modifier.height(10.dp))
          AppTextField(
            s.newPassword, vm::onNewPassword, "New password",
            visualTransformation = if (s.showPassword) VisualTransformation.None else PasswordVisualTransformation(),
            trailing = {
              IconButton(onClick = vm::toggleShow) {
                Icon(if (s.showPassword) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, null, tint = InkFaint)
              }
            },
          )
          Spacer(Modifier.height(10.dp))
          AppTextField(
            s.confirmPassword, vm::onConfirmPassword, "Confirm new password",
            visualTransformation = if (s.showPassword) VisualTransformation.None else PasswordVisualTransformation(),
          )
          s.error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = Rose, style = MaterialTheme.typography.bodySmall) }
          Spacer(Modifier.height(14.dp))
          PrimaryButton(if (s.loading) "" else "Reset Password", loading = s.loading, onClick = vm::reset, modifier = Modifier.fillMaxWidth())
          Spacer(Modifier.height(4.dp))
          Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = vm::backToEmail) { Text("Change email", color = InkSoft, style = MaterialTheme.typography.labelLarge) }
            TextButton(onClick = vm::sendOtp, enabled = !s.loading) { Text("Resend code", color = Green, style = MaterialTheme.typography.labelLarge) }
          }
        }
      }
    }
  }
}
