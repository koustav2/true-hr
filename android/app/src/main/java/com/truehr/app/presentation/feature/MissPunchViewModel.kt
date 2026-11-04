package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiError
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

  val fieldErrors = MutableStateFlow<Map<String, String>>(emptyMap())
  fun clearFieldError(k: String) = fieldErrors.update { it - k }

  /** E7: every rule checked at once, here and again on the server. */
  fun apply(days: String, month: Int, year: Int?, inTime: String, outTime: String, remarks: String) = viewModelScope.launch {
    val errs = com.truehr.app.core.Validators.missPunch(days, month, year, inTime, outTime, remarks, com.truehr.app.core.Dates.todayIso())
    fieldErrors.value = errs
    if (errs.isNotEmpty()) { applyError.value = null; return@launch }
    submitting.value = true; applyError.value = null
    try { repo.apply(days.split(',').map { it.trim() }.filter { it.isNotEmpty() }.joinToString(","), month, year!!, remarks.trim(), inTime.trim(), outTime.trim()); applied.value = true }
    catch (e: Exception) {
      val err = e.apiError("Failed to submit request")
      fieldErrors.value = err.fields
      applyError.value = err.summary(setOf("days", "month", "year", "inTime", "outTime", "remarks"))
    }
    finally { submitting.value = false }
  }

  fun cancel(id: Long) = viewModelScope.launch {
    reviewBusy.value = id
    try { repo.cancel(id); load(lastStatus, lastTeam) }
    catch (e: Exception) { list.update { it.copy(error = e.apiMessage("Could not cancel request")) } }
    finally { reviewBusy.value = null }
  }

  // list (own or team)
  private var lastStatus = "PENDING"
  private var lastTeam = false
  val list = MutableStateFlow(UiState<List<MissPunch>>())
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
