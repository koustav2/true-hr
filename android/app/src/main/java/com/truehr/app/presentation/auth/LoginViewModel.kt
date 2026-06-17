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
  fun toggleShow() = _state.update { it.copy(showPassword = !it.showPassword) }
  fun consumeEvent() { _event.value = null }

  fun login() {
    val s = _state.value
    if (s.email.isBlank() || s.password.isBlank()) {
      _state.update { it.copy(error = "Enter your username and password") }
      return
    }
    _state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      try {
        val user = authRepository.login(s.email, s.password)
        _state.update { it.copy(loading = false) }
        _event.value = if (user.mustChangePassword) LoginEvent.MustChangePassword else LoginEvent.GoHome
      } catch (e: Exception) {
        _state.update { it.copy(loading = false, error = friendly(e)) }
      }
    }
  }
}

fun friendly(e: Throwable): String = when {
  e.message?.contains("401") == true || e.message?.contains("Invalid", true) == true -> "Invalid username or password"
  e.message?.contains("Unable to resolve host") == true || e.message?.contains("Failed to connect") == true -> "Can't reach the server. Check your connection."
  else -> e.message ?: "Something went wrong"
}
