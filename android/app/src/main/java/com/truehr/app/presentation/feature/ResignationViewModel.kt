package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.Resignation
import com.truehr.app.domain.model.ResignationContext
import com.truehr.app.domain.repository.ResignationRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ResignationViewModel @Inject constructor(
  private val repo: ResignationRepository,
) : ViewModel() {

  // ── Employee side ──
  val context = MutableStateFlow(UiState<ResignationContext>())
  fun loadContext() = viewModelScope.launch {
    context.value = context.value.copy(loading = true, error = null)
    try { context.value = UiState(data = repo.context()) }
    catch (e: Exception) { context.value = UiState(error = e.apiMessage("Failed to load")) }
  }

  val submitting = MutableStateFlow(false)
  val message = MutableStateFlow<String?>(null)
  val done = MutableStateFlow(false)
  fun apply(resignationDate: String, lastWorkingDate: String, reason: String) = viewModelScope.launch {
    submitting.value = true; message.value = null
    try { repo.apply(resignationDate, lastWorkingDate, reason.ifBlank { null }); done.value = true; loadContext() }
    catch (e: Exception) { message.value = e.apiMessage("Could not submit resignation") }
    finally { submitting.value = false }
  }
  fun withdraw(id: Long) = viewModelScope.launch {
    submitting.value = true; message.value = null
    try { repo.withdraw(id); loadContext() }
    catch (e: Exception) { message.value = e.apiMessage("Could not withdraw") }
    finally { submitting.value = false }
  }
  fun consumeMessage() { message.value = null }

  // ── Manager side ──
  val team = MutableStateFlow(UiState<List<Resignation>>())
  val reviewBusy = MutableStateFlow<Long?>(null)
  fun loadTeam(status: String) = viewModelScope.launch {
    team.value = team.value.copy(loading = true, error = null)
    try { team.value = UiState(data = repo.team(status)) }
    catch (e: Exception) { team.value = UiState(error = e.apiMessage("Failed to load team resignations")) }
  }
  fun review(id: Long, decision: String, note: String?, status: String) = viewModelScope.launch {
    reviewBusy.value = id
    try { repo.review(id, decision, note); loadTeam(status) }
    catch (e: Exception) { team.value = team.value.copy(error = e.apiMessage("Could not submit decision")) }
    finally { reviewBusy.value = null }
  }
}
