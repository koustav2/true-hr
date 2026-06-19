package com.truehr.app.presentation.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.domain.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ChangePwState(
  val next: String = "",
  val confirm: String = "",
  val loading: Boolean = false,
  val error: String? = null,
  val done: Boolean = false,
)

@HiltViewModel
class ChangePasswordViewModel @Inject constructor(
  private val authRepository: AuthRepository,
) : ViewModel() {
  val state = MutableStateFlow(ChangePwState())
  fun onNext(v: String) = state.update { it.copy(next = v, error = null) }
  fun onConfirm(v: String) = state.update { it.copy(confirm = v, error = null) }

  fun submit() {
    val s = state.value
    if (s.next.length < 8) { state.update { it.copy(error = "New password must be at least 8 characters") }; return }
    if (s.next != s.confirm) { state.update { it.copy(error = "Passwords do not match") }; return }
    state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      try {
        authRepository.changePassword(s.next)
        state.update { it.copy(loading = false, done = true) }
      } catch (e: Exception) {
        state.update { it.copy(loading = false, error = friendly(e)) }
      }
    }
  }
}
