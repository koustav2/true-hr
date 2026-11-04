package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.Dates
import com.truehr.app.core.UiState
import com.truehr.app.core.Validators
import com.truehr.app.core.apiError
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.Holiday
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
  val holidays = MutableStateFlow<List<Holiday>>(emptyList())
  val submitting = MutableStateFlow(false)
  val applyError = MutableStateFlow<String?>(null)
  val fieldErrors = MutableStateFlow<Map<String, String>>(emptyMap())
  /** Non-null after a successful apply: the confirmation text (incl. who it waits with). */
  val applied = MutableStateFlow<String?>(null)

  fun loadApplyData() = viewModelScope.launch {
    balances.update { it.copy(loading = true, error = null) }
    try {
      types.value = repo.types()
      balances.value = UiState(data = repo.balances())
    } catch (e: Exception) { balances.value = UiState(error = e.apiMessage("Failed to load leave data")) }
    loadHolidays()
  }

  val holidaysError = MutableStateFlow<String?>(null)
  fun loadHolidays(year: Int = Dates.todayIso().take(4).toInt()) = viewModelScope.launch {
    holidaysError.value = null
    try { holidays.value = repo.holidays(year) + if (Dates.todayIso().substring(5, 7) >= "11") repo.holidays(year + 1) else emptyList() }
    catch (e: Exception) { holidaysError.value = e.apiMessage("Couldn't load the holiday list") }
  }

  fun clearFieldError(key: String) = fieldErrors.update { it - key }

  fun apply(
    type: LeaveType?, fromDate: String, toDate: String, reason: String, halfDay: Boolean, session: String?,
    certificate: String?, certificateMime: String?, certificateName: String?,
  ) = viewModelScope.launch {
    val bal = balances.value.data?.firstOrNull { it.code == type?.code }
    val rhDates = holidays.value.filter { it.restricted }.map { it.date }.toSet()
    val errs = Validators.leave(
      Validators.LeaveInput(
        leaveCode = type?.code.orEmpty(), leaveName = type?.name.orEmpty(),
        fromDate = fromDate, toDate = if (type?.singleDate == true || halfDay) fromDate else toDate,
        reason = reason, halfDay = halfDay, halfDaySession = session, allowHalfDay = type?.allowHalfDay ?: false,
        isRestrictedHoliday = type?.code == "RH", restrictedDates = rhDates,
        allowanceType = type != null && !type.requiresBalance && type.code != "LWP",
        allowanceLeft = bal?.available,
      ),
    )
    fieldErrors.value = errs
    if (errs.isNotEmpty()) { applyError.value = if (errs.size > 1) "Please fix the highlighted fields." else null; return@launch }
    submitting.value = true; applyError.value = null
    try {
      val approver = repo.apply(type!!.code, fromDate, if (type.singleDate || halfDay) fromDate else toDate, reason.trim(), halfDay, session,
        certificate, certificateMime, certificateName)
      applied.value = "Your leave request has been submitted." + (approver?.let { " Pending with $it." } ?: "")
    } catch (e: Exception) {
      val err = e.apiError("Failed to submit leave")
      fieldErrors.value = err.fields
      applyError.value = err.summary(SHOWN_LEAVE_FIELDS)
    } finally { submitting.value = false }
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
  val actionError = MutableStateFlow<String?>(null)
  fun review(id: Long, decision: String, note: String?) = viewModelScope.launch {
    reviewBusy.value = id; actionError.value = null
    try { repo.review(id, decision, note); load(lastStatus, lastTeam) }
    catch (e: Exception) { actionError.value = e.apiMessage("Could not update request") }
    finally { reviewBusy.value = null }
  }

  fun cancel(id: Long) = viewModelScope.launch {
    reviewBusy.value = id; actionError.value = null
    try { repo.cancel(id); load(lastStatus, lastTeam) }
    catch (e: Exception) { actionError.value = e.apiMessage("Could not cancel request") }
    finally { reviewBusy.value = null }
  }

  companion object {
    val SHOWN_LEAVE_FIELDS = setOf("leaveCode", "fromDate", "toDate", "reason", "halfDay", "halfDaySession", "certificate")
  }
}
