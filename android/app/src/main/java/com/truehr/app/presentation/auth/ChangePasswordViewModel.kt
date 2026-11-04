package com.truehr.app.presentation.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.Validators
import com.truehr.app.core.apiError
import com.truehr.app.domain.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ChangePwState(
  val current: String = "",
  val next: String = "",
  val confirm: String = "",
  val loading: Boolean = false,
  val error: String? = null,
  val fields: Map<String, String> = emptyMap(),
  val done: Boolean = false,
  val signedOut: Boolean = false,
)

@HiltViewModel
class ChangePasswordViewModel @Inject constructor(
  private val authRepository: AuthRepository,
) : ViewModel() {
  val state = MutableStateFlow(ChangePwState())
  fun onCurrent(v: String) = state.update { it.copy(current = v, error = null, fields = it.fields - "currentPassword") }
  fun onNext(v: String) = state.update { it.copy(next = v, error = null, fields = it.fields - "newPassword") }
  fun onConfirm(v: String) = state.update { it.copy(confirm = v, error = null, fields = it.fields - "confirm") }

  /** [forced] = first change with a temporary password (no current password needed). */
  fun submit(forced: Boolean) {
    val s = state.value
    val errs = Validators.password(s.current, s.next, s.confirm, requireCurrent = !forced)
    if (errs.isNotEmpty()) { state.update { it.copy(fields = errs, error = null) }; return }
    state.update { it.copy(loading = true, error = null, fields = emptyMap()) }
    viewModelScope.launch {
      try {
        authRepository.changePassword(if (forced) null else s.current, s.next)
        state.update { it.copy(loading = false, done = true) }
      } catch (e: Exception) {
        val err = e.apiError("Could not change the password")
        // 403 "That is not your current password" belongs under the current-password field.
        val fields = if (err.status == 403 && !forced) mapOf("currentPassword" to err.message) else err.fields
        state.update { it.copy(loading = false, fields = fields, error = if (fields.isEmpty()) err.message else null) }
      }
    }
  }

  fun signOut() = viewModelScope.launch {
    authRepository.logout()
    state.update { it.copy(signedOut = true) }
  }
}
