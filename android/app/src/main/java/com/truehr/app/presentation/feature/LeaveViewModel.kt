package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.LeaveBalance
import com.truehr.app.domain.model.LeaveRequest
import com.truehr.app.domain.model.LeaveType
import com.truehr.app.domain.repository.LeaveRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class LeaveViewModel @Inject constructor(
  private val repo: LeaveRepository,
) : ViewModel() {

  // ---- Apply ----
  val balances = MutableStateFlow(UiState<List<LeaveBalance>>())
  val types = MutableStateFlow<List<LeaveType>>(emptyList())
  val submitting = MutableStateFlow(false)
  val applyError = MutableStateFlow<String?>(null)
  val applied = MutableStateFlow(false)

  fun loadApplyData() = viewModelScope.launch {
    balances.update { it.copy(loading = true, error = null) }
    try {
      types.value = repo.types()
      balances.value = UiState(data = repo.balances())
    } catch (e: Exception) { balances.value = UiState(error = e.apiMessage("Failed to load leave data")) }
  }

  fun apply(leaveCode: String, fromDate: String, toDate: String, reason: String, halfDay: Boolean, certificate: String?, certificateMime: String?) = viewModelScope.launch {
    if (leaveCode.isBlank()) { applyError.value = "Select a leave type."; return@launch }
    if (fromDate.isBlank() || toDate.isBlank()) { applyError.value = "Select date(s)."; return@launch }
    if (fromDate > toDate) { applyError.value = "Start date cannot be after End date."; return@launch }
    submitting.value = true; applyError.value = null
    try { repo.apply(leaveCode, fromDate, toDate, reason.ifBlank { null }, halfDay, certificate, certificateMime); applied.value = true }
    catch (e: Exception) { applyError.value = e.apiMessage("Failed to submit leave") }
    finally { submitting.value = false }
  }

  // ---- List (own or team) ----
  private var lastStatus = "PENDING"
  private var lastTeam = false
  val list = MutableStateFlow(UiState<List<LeaveRequest>>())
  fun load(status: String, teamView: Boolean = false) = viewModelScope.launch {
    lastStatus = status; lastTeam = teamView
    list.update { it.copy(loading = true, error = null) }
    try { list.value = UiState(data = if (teamView) repo.team(status) else repo.list(status)) }
    catch (e: Exception) { list.value = UiState(error = e.apiMessage("Failed to load")) }
  }

  // ---- Manager approve / reject + employee cancel ----
  val reviewBusy = MutableStateFlow<Long?>(null)
  fun review(id: Long, decision: String, note: String?) = viewModelScope.launch {
    reviewBusy.value = id
    try { repo.review(id, decision, note); load(lastStatus, lastTeam) }
    catch (e: Exception) { list.update { it.copy(error = e.apiMessage("Could not update request")) } }
    finally { reviewBusy.value = null }
  }

  fun cancel(id: Long) = viewModelScope.launch {
    reviewBusy.value = id
    try { repo.cancel(id); load(lastStatus, lastTeam) }
    catch (e: Exception) { list.update { it.copy(error = e.apiMessage("Could not cancel request")) } }
    finally { reviewBusy.value = null }
  }
}
