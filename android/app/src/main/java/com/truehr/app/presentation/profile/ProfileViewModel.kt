package com.truehr.app.presentation.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.domain.model.Profile
import com.truehr.app.domain.repository.ProfileRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ProfileViewModel @Inject constructor(
  private val repository: ProfileRepository,
) : ViewModel() {
  val state = MutableStateFlow(UiState<Profile>(loading = true))
  init { load() }
  fun load() {
    state.update { it.copy(loading = true, error = null) }
    viewModelScope.launch {
      try { state.update { UiState(data = repository.getProfile()) } }
      catch (e: Exception) { state.update { UiState(error = e.message ?: "Failed to load profile") } }
    }
  }
}
