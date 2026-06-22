package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.Payslip
import com.truehr.app.domain.model.PayslipRow
import com.truehr.app.domain.repository.PayrollRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PayslipPdf(val bytes: ByteArray, val filename: String)

@HiltViewModel
class SalaryViewModel @Inject constructor(
  private val repo: PayrollRepository,
) : ViewModel() {

  val list = MutableStateFlow(UiState<List<PayslipRow>>())
  fun load() = viewModelScope.launch {
    list.value = list.value.copy(loading = true, error = null)
    try { list.value = UiState(data = repo.list()) }
    catch (e: Exception) { list.value = UiState(error = e.apiMessage("Failed to load salary slips")) }
  }

  val detail = MutableStateFlow(UiState<Payslip>())
  fun loadDetail(id: Long) = viewModelScope.launch {
    detail.value = detail.value.copy(loading = true, error = null)
    try { detail.value = UiState(data = repo.detail(id)) }
    catch (e: Exception) { detail.value = UiState(error = e.apiMessage("Failed to load payslip")) }
  }

  // PDF download/open
  val downloading = MutableStateFlow<Long?>(null)
  val downloaded = MutableStateFlow<PayslipPdf?>(null)
  val downloadError = MutableStateFlow<String?>(null)
  fun download(row: PayslipRow) = viewModelScope.launch {
    val id = row.id
    if (!row.available || id == null) { downloadError.value = "This payslip isn't available yet."; return@launch }
    downloading.value = id; downloadError.value = null
    try {
      downloaded.value = PayslipPdf(repo.pdfBytes(id), "payslip-${row.year}-${row.month}.pdf")
    } catch (e: Exception) { downloadError.value = e.apiMessage("Could not download the payslip") }
    finally { downloading.value = null }
  }
  fun consumeDownload() { downloaded.value = null }
}
