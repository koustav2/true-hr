package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.Policy
import com.truehr.app.domain.repository.PolicyRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PolicyFile(val bytes: ByteArray, val filename: String, val mime: String)

@HiltViewModel
class PolicyViewModel @Inject constructor(
  private val repo: PolicyRepository,
) : ViewModel() {
  val list = MutableStateFlow(UiState<List<Policy>>())
  fun load() = viewModelScope.launch {
    list.update { it.copy(loading = true, error = null) }
    try { list.value = UiState(data = repo.list()) }
    catch (e: Exception) { list.value = UiState(error = e.apiMessage("Failed to load policies")) }
  }

  val opening = MutableStateFlow<Long?>(null)
  val openFile = MutableStateFlow<PolicyFile?>(null)
  val openError = MutableStateFlow<String?>(null)
  fun open(p: Policy) = viewModelScope.launch {
    val id = p.id
    if (!p.available || id == null) { openError.value = "This document isn't available yet."; return@launch }
    opening.value = id; openError.value = null
    try {
      val bytes = repo.fileBytes(id)
      openFile.value = PolicyFile(bytes, p.filename ?: "${p.title}.pdf", p.mime ?: "application/octet-stream")
    } catch (e: Exception) { openError.value = e.apiMessage("Could not open the document") }
    finally { opening.value = null }
  }
  fun consumeOpen() { openFile.value = null }
}
