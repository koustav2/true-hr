package com.truehr.app.presentation.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.domain.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginState(
  val email: String = "",
  val password: String = "",
  val showPassword: Boolean = false,
  val loading: Boolean = false,
  val error: String? = null,
  // Two-step login: after the password, a code is emailed and entered here.
  val otpStage: Boolean = false,
  val otp: String = "",
  val maskedEmail: String? = null,
  val info: String? = null,
)

sealed interface LoginEvent {
  data object GoHome : LoginEvent
  data object MustChangePassword : LoginEvent
}

@HiltViewModel
class LoginViewModel @Inject constructor(
  private val authRepository: AuthRepository,
) : ViewModel() {

  private val _state = MutableStateFlow(LoginState())
  val state: StateFlow<LoginState> = _state.asStateFlow()

  private val _event = MutableStateFlow<LoginEvent?>(null)
  val event: StateFlow<LoginEvent?> = _event.asStateFlow()

  fun onEmail(v: String) = _state.update { it.copy(email = v, error = null) }
  fun onPassword(v: String) = _state.update { it.copy(password = v, error = null) }
  fun onOtp(v: String) = _state.update { it.copy(otp = v.filter { c -> c.isDigit() }.take(6), error = null, info = null) }
  fun toggleShow() = _state.update { it.copy(showPassword = !it.showPassword) }
  fun backToPassword() = _state.update { it.copy(otpStage = false, otp = "", error = null, info = null) }
  fun consumeEvent() { _event.value = null }

  fun login(resend: Boolean = false) {
    val s = _state.value
    if (s.email.isBlank() || s.password.isBlank()) {
      _state.update { it.copy(error = "Enter your username and password") }
      return
    }
    _state.update { it.copy(loading = true, error = null, info = null) }
    viewModelScope.launch {
      try {
        val result = authRepository.login(s.email, s.password)
        if (result.otpRequired) {
          _state.update {
            it.copy(loading = false, otpStage = true, otp = "", maskedEmail = result.maskedEmail,
              info = if (resend) "A new code has been emailed." else null)
          }
        } else {
          _state.update { it.copy(loading = false) }
          _event.value = if (result.user?.mustChangePassword == true) LoginEvent.MustChangePassword else LoginEvent.GoHome
        }
      } catch (e: Exception) {
        _state.update { it.copy(loading = false, error = friendly(e)) }
      }
    }
  }

  fun verifyOtp() {
    val s = _state.value
    if (s.otp.length != 6) {
      _state.update { it.copy(error = "Enter the 6-digit code") }
      return
    }
    _state.update { it.copy(loading = true, error = null, info = null) }
    viewModelScope.launch {
      try {
        val user = authRepository.verifyLoginOtp(s.email, s.otp)
        _state.update { it.copy(loading = false) }
        _event.value = if (user.mustChangePassword) LoginEvent.MustChangePassword else LoginEvent.GoHome
      } catch (e: Exception) {
        _state.update { it.copy(loading = false, error = friendlyOtp(e)) }
      }
    }
  }
}

private fun friendlyOtp(e: Throwable): String = when {
  e.message?.contains("Invalid", true) == true || e.message?.contains("400") == true -> "Invalid or expired code"
  e.message?.contains("429") == true -> "Too many wrong attempts — sign in again for a new code"
  else -> friendly(e)
}

fun friendly(e: Throwable): String = when {
  e.message?.contains("401") == true || e.message?.contains("Invalid", true) == true -> "Invalid username or password"
  e.message?.contains("Unable to resolve host") == true || e.message?.contains("Failed to connect") == true -> "Can't reach the server. Check your connection."
  else -> e.message ?: "Something went wrong"
}
