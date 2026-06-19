package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.OnDuty
import com.truehr.app.domain.repository.OnDutyRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class OnDutyViewModel @Inject constructor(
  private val repo: OnDutyRepository,
) : ViewModel() {

  // apply
  val submitting = MutableStateFlow(false)
  val applyError = MutableStateFlow<String?>(null)
  val applied = MutableStateFlow(false)

  fun apply(fromDate: String, toDate: String, dayType: String, place: String, reason: String, photo: String?, lat: Double?, lng: Double?, address: String?) = viewModelScope.launch {
    if (fromDate.isBlank() || toDate.isBlank()) { applyError.value = "Select both From and To dates."; return@launch }
    if (fromDate > toDate) { applyError.value = "From date cannot be after To date."; return@launch }
    if (photo == null) { applyError.value = "Capture a photo with your location to apply."; return@launch }
    submitting.value = true; applyError.value = null
    try {
      repo.apply(fromDate, toDate, dayType, place.ifBlank { null }, reason.ifBlank { null }, photo, lat, lng, address)
      applied.value = true
    } catch (e: Exception) { applyError.value = e.apiMessage("Failed to submit request") }
    finally { submitting.value = false }
  }

  // list (own or team)
  private var lastStatus = "PENDING"
  private var lastTeam = false
  val list = MutableStateFlow(UiState<List<OnDuty>>())
  fun load(status: String, teamView: Boolean = false) = viewModelScope.launch {
    lastStatus = status; lastTeam = teamView
    list.update { it.copy(loading = true, error = null) }
    try { list.value = UiState(data = if (teamView) repo.team(status) else repo.list(status)) }
    catch (e: Exception) { list.value = UiState(error = e.apiMessage("Failed to load")) }
  }

  // manager approve / reject
  val reviewBusy = MutableStateFlow<Long?>(null)
  fun review(id: Long, decision: String, note: String?) = viewModelScope.launch {
    reviewBusy.value = id
    try { repo.review(id, decision, note); load(lastStatus, lastTeam) }
    catch (e: Exception) { list.update { it.copy(error = e.apiMessage("Could not update request")) } }
    finally { reviewBusy.value = null }
  }
}
