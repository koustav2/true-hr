package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.AttendanceDay
import com.truehr.app.domain.model.MonthlyAttendance
import com.truehr.app.domain.model.TeamMember
import com.truehr.app.domain.repository.AttendanceRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.Calendar
import javax.inject.Inject

@HiltViewModel
class AttendanceViewModel @Inject constructor(
  private val repo: AttendanceRepository,
) : ViewModel() {

  val punchedIn = MutableStateFlow(false)
  val completed = MutableStateFlow(false)   // both IN and OUT done today
  val submitting = MutableStateFlow(false)
  val message = MutableStateFlow<String?>(null)
  val daily = MutableStateFlow(UiState<List<AttendanceDay>>())

  fun refreshToday() = viewModelScope.launch {
    runCatching { repo.todayStatus() }.onSuccess {
      punchedIn.value = it.punchedIn
      completed.value = it.completed
    }
  }

  fun submitPunch(type: String, lat: Double?, lng: Double?, address: String?, photoBase64: String?) =
    viewModelScope.launch {
      submitting.value = true; message.value = null
      try {
        repo.punch(type, lat, lng, address, photoBase64)
        message.value = if (type == "IN") "Punched in successfully." else "Punched out successfully."
        refreshToday()
      } catch (e: Exception) {
        message.value = e.apiMessage("Failed to submit attendance")
        refreshToday()
      } finally {
        submitting.value = false
      }
    }

  // Optional team-member target (null = self)
  private var dailyEmp: Long? = null
  private var monthlyEmp: Long? = null

  fun loadDaily(year: Int? = null, month: Int? = null, employeeId: Long? = dailyEmp) = viewModelScope.launch {
    dailyEmp = employeeId
    val cal = Calendar.getInstance()
    val y = year ?: cal.get(Calendar.YEAR)
    val m = month ?: (cal.get(Calendar.MONTH) + 1)
    daily.update { it.copy(loading = true, error = null) }
    try { daily.value = UiState(data = repo.daily(y, m, employeeId)) }
    catch (e: Exception) { daily.value = UiState(error = e.apiMessage("Failed to load attendance")) }
  }

  // ---- Monthly calendar ----
  private val cal = Calendar.getInstance()
  val curYear = MutableStateFlow(cal.get(Calendar.YEAR))
  val curMonth = MutableStateFlow(cal.get(Calendar.MONTH) + 1) // 1-12
  val monthly = MutableStateFlow(UiState<MonthlyAttendance>())

  fun loadMonthly(employeeId: Long? = monthlyEmp) = viewModelScope.launch {
    monthlyEmp = employeeId
    monthly.update { it.copy(loading = true, error = null) }
    try { monthly.value = UiState(data = repo.monthly(curYear.value, curMonth.value, employeeId)) }
    catch (e: Exception) { monthly.value = UiState(error = e.apiMessage("Failed to load")) }
  }

  fun changeMonth(delta: Int) {
    var m = curMonth.value + delta
    var y = curYear.value
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    curMonth.value = m; curYear.value = y
    loadMonthly()
  }

  // ---- Team attendance ----
  val team = MutableStateFlow(UiState<List<TeamMember>>())
  val holdBusy = MutableStateFlow<Long?>(null)   // employeeId currently toggling
  fun loadTeam() = viewModelScope.launch {
    team.update { it.copy(loading = true, error = null) }
    try { team.value = UiState(data = repo.team()) }
    catch (e: Exception) { team.value = UiState(error = e.apiMessage("Failed to load team")) }
  }

  fun toggleHold(member: TeamMember) = viewModelScope.launch {
    holdBusy.value = member.employeeId
    try {
      if (member.held) repo.releaseTeam(member.employeeId) else repo.holdTeam(member.employeeId)
      loadTeam()
    } catch (e: Exception) {
      team.update { it.copy(error = e.apiMessage("Could not update hold")) }
    } finally { holdBusy.value = null }
  }
}
