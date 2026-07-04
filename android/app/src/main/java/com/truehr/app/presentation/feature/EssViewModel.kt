package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.KpiDetail
import com.truehr.app.domain.model.KpiRow
import com.truehr.app.domain.model.KraInput
import com.truehr.app.domain.model.PendingRating
import com.truehr.app.domain.model.PmsScoreInput
import com.truehr.app.domain.model.Settlement
import com.truehr.app.domain.model.TeamKpiRow
import com.truehr.app.domain.repository.EssRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class EssViewModel @Inject constructor(
  private val repo: EssRepository,
) : ViewModel() {

  // ---- Settlements ----
  val settlement = MutableStateFlow(UiState<Settlement>())
  fun loadSettlement(nfaId: Long) = viewModelScope.launch {
    settlement.update { it.copy(loading = true, error = null) }
    try { settlement.value = UiState(data = repo.settlementForNfa(nfaId)) }
    catch (e: Exception) { settlement.value = UiState(error = e.apiMessage("No settlement yet")) }
  }

  val settlementBusy = MutableStateFlow(false)
  val settlementError = MutableStateFlow<String?>(null)
  val settlementDone = MutableStateFlow(false)
  fun submitSettlement(nfaId: Long, amount: Double?, remarks: String) = viewModelScope.launch {
    if (amount == null || amount <= 0) { settlementError.value = "Enter the settlement amount."; return@launch }
    settlementBusy.value = true; settlementError.value = null
    try { settlement.value = UiState(data = repo.submitSettlement(nfaId, amount, remarks.ifBlank { null })); settlementDone.value = true }
    catch (e: Exception) { settlementError.value = e.apiMessage("Could not submit settlement") }
    finally { settlementBusy.value = false }
  }

  val settlementInbox = MutableStateFlow(UiState<List<Settlement>>())
  fun loadSettlementInbox() = viewModelScope.launch {
    settlementInbox.update { it.copy(loading = true, error = null) }
    try { settlementInbox.value = UiState(data = repo.settlementsPending()) }
    catch (e: Exception) { settlementInbox.value = UiState(error = e.apiMessage("Failed to load settlements")) }
  }

  fun settlementAct(id: Long, action: String, remarks: String?) = viewModelScope.launch {
    settlementBusy.value = true; settlementError.value = null
    try { repo.settlementAct(id, action, remarks); loadSettlementInbox() }
    catch (e: Exception) { settlementError.value = e.apiMessage("Could not submit decision") }
    finally { settlementBusy.value = false }
  }

  // ---- My performance ----
  val performance = MutableStateFlow(UiState<List<KpiRow>>())
  fun loadPerformance(year: Int) = viewModelScope.launch {
    performance.update { it.copy(loading = true, error = null) }
    try { performance.value = UiState(data = repo.kpiList(year)) }
    catch (e: Exception) { performance.value = UiState(error = e.apiMessage("Failed to load performance")) }
  }

  val kpiDetail = MutableStateFlow(UiState<KpiDetail>())
  fun loadKpiDetail(id: Long) = viewModelScope.launch {
    kpiDetail.update { it.copy(loading = true, error = null) }
    try { kpiDetail.value = UiState(data = repo.kpiDetail(id)) }
    catch (e: Exception) { kpiDetail.value = UiState(error = e.apiMessage("Failed to load KPI")) }
  }

  val kpiBusy = MutableStateFlow(false)
  val kpiError = MutableStateFlow<String?>(null)
  val kpiDone = MutableStateFlow(false)
  fun createKpi(year: Int, month: Int, copyPrevious: Boolean, kras: List<KraInput>) = viewModelScope.launch {
    if (!copyPrevious) {
      val sum = kras.sumOf { it.weightage }
      if (kras.isEmpty()) { kpiError.value = "Add at least one KRA."; return@launch }
      if (kotlin.math.abs(sum - 100.0) > 0.01) { kpiError.value = "Weightages must sum to 100 (currently ${sum.toInt()})."; return@launch }
    }
    kpiBusy.value = true; kpiError.value = null
    try { repo.createKpi(year, month, copyPrevious, if (copyPrevious) null else kras); kpiDone.value = true }
    catch (e: Exception) { kpiError.value = e.apiMessage("Could not create KPI") }
    finally { kpiBusy.value = false }
  }

  fun submitPms(kpiId: Long, scores: List<PmsScoreInput>) = viewModelScope.launch {
    kpiBusy.value = true; kpiError.value = null
    try { kpiDetail.value = UiState(data = repo.submitPms(kpiId, scores)); kpiDone.value = true }
    catch (e: Exception) { kpiError.value = e.apiMessage("Could not submit PMS") }
    finally { kpiBusy.value = false }
  }
  fun consumeKpiDone() { kpiDone.value = false }

  // ---- Team KPI / rating queues ----
  val teamKpi = MutableStateFlow(UiState<List<TeamKpiRow>>())
  fun loadTeamKpi() = viewModelScope.launch {
    teamKpi.update { it.copy(loading = true, error = null) }
    try { teamKpi.value = UiState(data = repo.teamPending()) }
    catch (e: Exception) { teamKpi.value = UiState(error = e.apiMessage("Failed to load team KPIs")) }
  }

  fun reviewKpi(id: Long, action: String) = viewModelScope.launch {
    kpiBusy.value = true; kpiError.value = null
    try { repo.reviewKpi(id, action); loadTeamKpi() }
    catch (e: Exception) { kpiError.value = e.apiMessage("Could not review KPI") }
    finally { kpiBusy.value = false }
  }

  val ratingQueue = MutableStateFlow(UiState<List<PendingRating>>())
  fun loadRatingQueue() = viewModelScope.launch {
    ratingQueue.update { it.copy(loading = true, error = null) }
    try { ratingQueue.value = UiState(data = repo.pmsPending()) }
    catch (e: Exception) { ratingQueue.value = UiState(error = e.apiMessage("Failed to load rating queue")) }
  }

  fun ratePms(submissionId: Long, pliRating: Int, pliPct: Double, remarks: String) = viewModelScope.launch {
    kpiBusy.value = true; kpiError.value = null
    try { repo.ratePms(submissionId, pliRating, pliPct, remarks.ifBlank { null }); loadRatingQueue() }
    catch (e: Exception) { kpiError.value = e.apiMessage("Could not submit rating") }
    finally { kpiBusy.value = false }
  }

  // ---- Vendors & agreements ----
  val vendors = MutableStateFlow(UiState<List<com.truehr.app.domain.model.VendorRow>>())
  fun loadVendors() = viewModelScope.launch {
    vendors.update { it.copy(loading = true, error = null) }
    try { vendors.value = UiState(data = repo.vendors()) }
    catch (e: Exception) { vendors.value = UiState(error = e.apiMessage("Failed to load vendors")) }
  }

  val agreements = MutableStateFlow(UiState<List<com.truehr.app.domain.model.AgreementRow>>())
  fun loadAgreements() = viewModelScope.launch {
    agreements.update { it.copy(loading = true, error = null) }
    try { agreements.value = UiState(data = repo.agreements()) }
    catch (e: Exception) { agreements.value = UiState(error = e.apiMessage("Failed to load agreements")) }
  }

  val formBusy = MutableStateFlow(false)
  val formError = MutableStateFlow<String?>(null)
  val formDone = MutableStateFlow(false)
  fun createVendor(input: com.truehr.app.domain.model.VendorInput) = viewModelScope.launch {
    if (input.companyName.isBlank()) { formError.value = "Enter the company name."; return@launch }
    formBusy.value = true; formError.value = null
    try { repo.createVendor(input); formDone.value = true; loadVendors() }
    catch (e: Exception) { formError.value = e.apiMessage("Could not register vendor") }
    finally { formBusy.value = false }
  }

  fun createAgreement(input: com.truehr.app.domain.model.AgreementInput) = viewModelScope.launch {
    if (input.startDate.isBlank() || input.endDate.isBlank()) { formError.value = "Enter the start and end dates."; return@launch }
    formBusy.value = true; formError.value = null
    try { repo.createAgreement(input); formDone.value = true; loadAgreements() }
    catch (e: Exception) { formError.value = e.apiMessage("Could not upload agreement") }
    finally { formBusy.value = false }
  }
  fun consumeFormDone() { formDone.value = false }
}
