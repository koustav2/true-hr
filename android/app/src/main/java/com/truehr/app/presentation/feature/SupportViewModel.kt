package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.Validators
import com.truehr.app.core.apiError
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.SupportCategoryConfig
import com.truehr.app.domain.model.SupportTicket
import com.truehr.app.domain.model.TicketDetail
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
  val catalogError = MutableStateFlow<String?>(null)
  fun loadCatalog() = viewModelScope.launch {
    try { catalog.value = repo.catalog(); catalogError.value = null }
    catch (e: Exception) { catalogError.value = e.apiMessage("Couldn't load the issue types") }
  }

  // create
  val submitting = MutableStateFlow(false)
  val submitError = MutableStateFlow<String?>(null)
  val fieldErrors = MutableStateFlow<Map<String, String>>(emptyMap())
  /** Ticket number after a successful create (0 when the server gave none). */
  val submitted = MutableStateFlow<Long?>(null)
  fun clearFieldError(k: String) = fieldErrors.update { it - k }

  /** E40: every required field checked at once, then again by the server. */
  fun submit(category: String, subject: String, issueType: String, issueDetail: String, description: String, attachment: String?, attachmentMime: String?, attachmentName: String?) = viewModelScope.launch {
    val detailRequired = catalog.value[category]?.details?.get(issueType)?.isNotEmpty() == true
    val errs = Validators.supportTicket(issueType, detailRequired, issueDetail, subject, description)
    fieldErrors.value = errs
    if (errs.isNotEmpty()) { submitError.value = null; return@launch }
    submitting.value = true; submitError.value = null
    try {
      submitted.value = repo.create(category, subject.trim(), issueType, issueDetail.ifBlank { null }, description.trim(), attachment, attachmentMime, attachmentName) ?: 0L
    } catch (e: Exception) {
      val err = e.apiError("Failed to submit request")
      fieldErrors.value = err.fields
      submitError.value = err.summary(setOf("issueType", "issueDetail", "subject", "description", "attachment"))
    } finally { submitting.value = false }
  }

  // list
  val list = MutableStateFlow(UiState<List<SupportTicket>>())
  private var lastQuery: Triple<String, String?, String?> = Triple("HR", null, null)
  fun load(category: String, from: String? = null, to: String? = null) = viewModelScope.launch {
    lastQuery = Triple(category, from, to)
    list.update { it.copy(loading = true, error = null) }
    try { list.value = UiState(data = repo.list(category, from, to)) }
    catch (e: Exception) { list.value = UiState(error = e.apiMessage("Failed to load tickets")) }
  }

  // detail: thread, reply, cancel, reopen (E42)
  val detail = MutableStateFlow(UiState<TicketDetail>())
  val detailBusy = MutableStateFlow(false)
  val detailError = MutableStateFlow<String?>(null)
  fun openDetail(id: Long) = viewModelScope.launch {
    detail.value = UiState(loading = true); detailError.value = null
    try { detail.value = UiState(data = repo.detail(id)) }
    catch (e: Exception) { detail.value = UiState(error = e.apiMessage("Couldn't open the ticket")) }
  }
  fun closeDetail() { detail.value = UiState(); detailError.value = null }

  private fun act(id: Long, block: suspend () -> Unit) = viewModelScope.launch {
    detailBusy.value = true; detailError.value = null
    try { block(); detail.value = UiState(data = repo.detail(id)); load(lastQuery.first, lastQuery.second, lastQuery.third) }
    catch (e: Exception) { detailError.value = e.apiMessage("That didn't work. Please try again.") }
    finally { detailBusy.value = false }
  }

  /** Returns false (with [detailError] set) when the text fails the rules. */
  fun reply(id: Long, body: String): Boolean {
    Validators.supportReply(body).values.firstOrNull()?.let { detailError.value = it; return false }
    act(id) { repo.reply(id, body.trim()) }; return true
  }
  fun cancel(id: Long) = act(id) { repo.cancel(id, null) }
  fun reopen(id: Long, reason: String): Boolean {
    Validators.supportReply(reason, "Reason for reopening", "reason").values.firstOrNull()?.let { detailError.value = it; return false }
    act(id) { repo.reopen(id, reason.trim()) }; return true
  }
}
