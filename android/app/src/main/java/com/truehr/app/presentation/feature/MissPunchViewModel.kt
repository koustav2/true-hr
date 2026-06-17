package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.MissPunch
import com.truehr.app.domain.repository.MissPunchRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MissPunchViewModel @Inject constructor(
  private val repo: MissPunchRepository,
) : ViewModel() {

  // apply
  val submitting = MutableStateFlow(false)
  val applyError = MutableStateFlow<String?>(null)
  val applied = MutableStateFlow(false)

  fun apply(days: String, month: Int, year: Int, remarks: String) = viewModelScope.launch {
    if (days.isBlank()) { applyError.value = "Enter day(s) of the month."; return@launch }
    submitting.value = true; applyError.value = null
    try { repo.apply(days, month, year, remarks.ifBlank { null }); applied.value = true }
    catch (e: Exception) { applyError.value = e.apiMessage("Failed to submit request") }
    finally { submitting.value = false }
  }

  // list (own or team)
  val list = MutableStateFlow(UiState<List<MissPunch>>())
  fun load(status: String, teamView: Boolean = false) = viewModelScope.launch {
    list.update { it.copy(loading = true, error = null) }
    try { list.value = UiState(data = if (teamView) repo.team(status) else repo.list(status)) }
    catch (e: Exception) { list.value = UiState(error = e.apiMessage("Failed to load")) }
  }
}
