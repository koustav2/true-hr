package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.TeamMate
import com.truehr.app.domain.repository.ProfileRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class TeamListViewModel @Inject constructor(
  private val repo: ProfileRepository,
) : ViewModel() {
  val list = MutableStateFlow(UiState<List<TeamMate>>())
  fun load() = viewModelScope.launch {
    list.update { it.copy(loading = true, error = null) }
    try { list.value = UiState(data = repo.myTeam()) }
    catch (e: Exception) { list.value = UiState(error = e.apiMessage("Failed to load team")) }
  }
}
