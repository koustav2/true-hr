package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.Task
import com.truehr.app.domain.model.TaskSummary
import com.truehr.app.domain.model.TeamTaskSummary
import com.truehr.app.domain.model.TeamMate
import com.truehr.app.domain.repository.ProfileRepository
import com.truehr.app.domain.repository.TaskRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class TaskViewModel @Inject constructor(
  private val repo: TaskRepository,
  private val profileRepo: ProfileRepository,
) : ViewModel() {

  // ── Employee: my tasks ──
  val summary = MutableStateFlow<TaskSummary?>(null)
  val myTasks = MutableStateFlow(UiState<List<Task>>())
  fun loadMine(status: String?) = viewModelScope.launch {
    myTasks.value = myTasks.value.copy(loading = true, error = null)
    try {
      summary.value = repo.summary()
      myTasks.value = UiState(data = repo.mine(status))
    } catch (e: Exception) { myTasks.value = UiState(error = e.apiMessage("Failed to load tasks")) }
  }
  val statusBusy = MutableStateFlow<Long?>(null)
  fun setStatus(id: Long, status: String, remark: String?, filter: String?) = viewModelScope.launch {
    statusBusy.value = id
    try { repo.updateStatus(id, status, remark); loadMine(filter) }
    catch (e: Exception) { myTasks.value = myTasks.value.copy(error = e.apiMessage("Could not update task")) }
    finally { statusBusy.value = null }
  }

  // ── Manager: assign ──
  val teamMembers = MutableStateFlow<List<TeamMate>>(emptyList())
  fun loadTeamMembers() = viewModelScope.launch {
    runCatching { profileRepo.myTeam() }.onSuccess { teamMembers.value = it }
  }
  val submitting = MutableStateFlow(false)
  val message = MutableStateFlow<String?>(null)
  val created = MutableStateFlow(false)
  fun assign(assignedTo: Long, title: String, description: String, dueDate: String?, aroundTime: String) = viewModelScope.launch {
    submitting.value = true; message.value = null
    try { repo.create(assignedTo, title, description.ifBlank { null }, dueDate, aroundTime.ifBlank { null }); created.value = true }
    catch (e: Exception) { message.value = e.apiMessage("Could not assign task") }
    finally { submitting.value = false }
  }
  fun consumeMessage() { message.value = null }

  // ── Manager: team view ──
  val teamSummary = MutableStateFlow(UiState<List<TeamTaskSummary>>())
  val teamTasks = MutableStateFlow(UiState<List<Task>>())
  fun loadTeam(status: String?) = viewModelScope.launch {
    teamSummary.value = teamSummary.value.copy(loading = true, error = null)
    try {
      teamSummary.value = UiState(data = repo.teamSummary())
      teamTasks.value = UiState(data = repo.team(null, status))
    } catch (e: Exception) {
      teamSummary.value = UiState(error = e.apiMessage("Failed to load team tasks"))
      teamTasks.value = UiState(error = "")
    }
  }
}
