package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.SupportCategoryConfig
import com.truehr.app.domain.model.SupportTicket
import com.truehr.app.domain.repository.SupportRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SupportViewModel @Inject constructor(
  private val repo: SupportRepository,
) : ViewModel() {

  val catalog = MutableStateFlow<Map<String, SupportCategoryConfig>>(emptyMap())
  fun loadCatalog() = viewModelScope.launch {
    runCatching { repo.catalog() }.onSuccess { catalog.value = it }
  }

  // create
  val submitting = MutableStateFlow(false)
  val submitError = MutableStateFlow<String?>(null)
  val submitted = MutableStateFlow(false)
  fun submit(category: String, issueType: String, issueDetail: String?, description: String, attachment: String?, attachmentMime: String?) = viewModelScope.launch {
    if (issueType.isBlank()) { submitError.value = "Select an issue type."; return@launch }
    submitting.value = true; submitError.value = null
    try { repo.create(category, issueType, issueDetail, description.ifBlank { null }, attachment, attachmentMime); submitted.value = true }
    catch (e: Exception) { submitError.value = e.apiMessage("Failed to submit request") }
    finally { submitting.value = false }
  }

  // list
  val list = MutableStateFlow(UiState<List<SupportTicket>>())
  fun load(category: String, from: String? = null, to: String? = null) = viewModelScope.launch {
    list.update { it.copy(loading = true, error = null) }
    try { list.value = UiState(data = repo.list(category, from, to)) }
    catch (e: Exception) { list.value = UiState(error = e.apiMessage("Failed to load tickets")) }
  }
}
