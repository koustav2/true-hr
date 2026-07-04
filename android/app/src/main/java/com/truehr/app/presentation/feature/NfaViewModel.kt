package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.NfaCreateInput
import com.truehr.app.domain.model.NfaDetail
import com.truehr.app.domain.model.NfaLedger
import com.truehr.app.domain.model.NfaMasters
import com.truehr.app.domain.model.NfaPreviewStage
import com.truehr.app.domain.model.NfaRow
import com.truehr.app.domain.repository.NfaRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class NfaViewModel @Inject constructor(
  private val repo: NfaRepository,
) : ViewModel() {

  // ---- Create form ----
  val masters = MutableStateFlow(UiState<NfaMasters>())
  fun loadMasters() = viewModelScope.launch {
    masters.update { it.copy(loading = true, error = null) }
    try { masters.value = UiState(data = repo.masters()) }
    catch (e: Exception) { masters.value = UiState(error = e.apiMessage("Failed to load NFA masters")) }
  }

  val preview = MutableStateFlow(UiState<List<NfaPreviewStage>>())
  fun loadPreview(projectId: Long, expenseCategoryId: Long, zoneId: Long) = viewModelScope.launch {
    preview.update { it.copy(loading = true, error = null) }
    try { preview.value = UiState(data = repo.approvalPreview(projectId, expenseCategoryId, zoneId)) }
    catch (e: Exception) { preview.value = UiState(error = e.apiMessage("Failed to load approver chain")) }
  }

  val submitting = MutableStateFlow(false)
  val createError = MutableStateFlow<String?>(null)
  val created = MutableStateFlow(false)
  fun create(input: NfaCreateInput) = viewModelScope.launch {
    if (input.purpose.isBlank()) { createError.value = "Enter the purpose."; return@launch }
    if (input.lines.isEmpty()) { createError.value = "Add at least one line item."; return@launch }
    submitting.value = true; createError.value = null
    try { repo.create(input); created.value = true }
    catch (e: Exception) { createError.value = e.apiMessage("Failed to submit NFA") }
    finally { submitting.value = false }
  }

  // ---- My NFAs ----
  val list = MutableStateFlow(UiState<List<NfaRow>>())
  fun loadList(year: Int?, month: Int?, status: String?) = viewModelScope.launch {
    list.update { it.copy(loading = true, error = null) }
    try { list.value = UiState(data = repo.list(year, month, status)) }
    catch (e: Exception) { list.value = UiState(error = e.apiMessage("Failed to load NFAs")) }
  }

  // ---- Approvals inbox ----
  val pending = MutableStateFlow(UiState<List<NfaRow>>())
  fun loadPending() = viewModelScope.launch {
    pending.update { it.copy(loading = true, error = null) }
    try { pending.value = UiState(data = repo.pending()) }
    catch (e: Exception) { pending.value = UiState(error = e.apiMessage("Failed to load pending approvals")) }
  }

  // ---- Detail + act / resubmit ----
  val detail = MutableStateFlow(UiState<NfaDetail>())
  fun loadDetail(id: Long) = viewModelScope.launch {
    detail.update { it.copy(loading = true, error = null) }
    try { detail.value = UiState(data = repo.detail(id)) }
    catch (e: Exception) { detail.value = UiState(error = e.apiMessage("Failed to load NFA")) }
  }

  val actBusy = MutableStateFlow(false)
  val actError = MutableStateFlow<String?>(null)
  val acted = MutableStateFlow(false)
  fun act(id: Long, action: String, remarks: String?) = viewModelScope.launch {
    actBusy.value = true; actError.value = null
    try { detail.value = UiState(data = repo.act(id, action, remarks)); acted.value = true }
    catch (e: Exception) { actError.value = e.apiMessage("Could not submit decision") }
    finally { actBusy.value = false }
  }

  fun resubmit(id: Long, remarks: String) = viewModelScope.launch {
    if (remarks.isBlank()) { actError.value = "Enter a remark before resubmitting."; return@launch }
    actBusy.value = true; actError.value = null
    try { detail.value = UiState(data = repo.resubmit(id, remarks)); acted.value = true }
    catch (e: Exception) { actError.value = e.apiMessage("Could not resubmit NFA") }
    finally { actBusy.value = false }
  }
  fun consumeActError() { actError.value = null }
  fun consumeActed() { acted.value = false }

  // ---- Ledger ----
  val ledger = MutableStateFlow(UiState<NfaLedger>())
  fun loadLedger() = viewModelScope.launch {
    ledger.update { it.copy(loading = true, error = null) }
    try { ledger.value = UiState(data = repo.ledger()) }
    catch (e: Exception) { ledger.value = UiState(error = e.apiMessage("Failed to load ledger")) }
  }
}
