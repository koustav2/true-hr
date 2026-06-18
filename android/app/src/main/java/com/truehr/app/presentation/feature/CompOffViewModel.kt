package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.CompOffCredit
import com.truehr.app.domain.model.CompOffRequest
import com.truehr.app.domain.repository.CompOffRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CompOffViewModel @Inject constructor(
  private val repo: CompOffRepository,
) : ViewModel() {

  // available OD credits to avail
  val credits = MutableStateFlow<List<CompOffCredit>>(emptyList())
  val submitting = MutableStateFlow(false)
  val applyError = MutableStateFlow<String?>(null)
  val applied = MutableStateFlow(false)

  fun loadCredits() = viewModelScope.launch {
    runCatching { repo.credits() }.onSuccess { credits.value = it }
  }

  fun apply(onDutyId: Long, leaveDate: String, remark: String) = viewModelScope.launch {
    if (onDutyId <= 0) { applyError.value = "Select an OD credit."; return@launch }
    if (leaveDate.isBlank()) { applyError.value = "Select a leave date."; return@launch }
    submitting.value = true; applyError.value = null
    try { repo.apply(onDutyId, leaveDate, remark.ifBlank { null }); applied.value = true; loadCredits() }
    catch (e: Exception) { applyError.value = e.apiMessage("Failed to submit comp-off") }
    finally { submitting.value = false }
  }

  fun resetApplied() { applied.value = false }

  // lists (own or team)
  private var lastStatus = "PENDING"
  private var lastTeam = false
  val list = MutableStateFlow(UiState<List<CompOffRequest>>())
  fun load(status: String, teamView: Boolean = false) = viewModelScope.launch {
    lastStatus = status; lastTeam = teamView
    list.update { it.copy(loading = true, error = null) }
    try { list.value = UiState(data = if (teamView) repo.team(status) else repo.list(status)) }
    catch (e: Exception) { list.value = UiState(error = e.apiMessage("Failed to load")) }
  }

  val reviewBusy = MutableStateFlow<Long?>(null)
  fun review(id: Long, decision: String, note: String?) = viewModelScope.launch {
    reviewBusy.value = id
    try { repo.review(id, decision, note); load(lastStatus, lastTeam) }
    catch (e: Exception) { list.update { it.copy(error = e.apiMessage("Could not update request")) } }
    finally { reviewBusy.value = null }
  }
}
