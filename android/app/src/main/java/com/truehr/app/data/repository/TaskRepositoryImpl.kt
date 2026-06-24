package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.CreateTaskRequest
import com.truehr.app.data.remote.dto.TaskDto
import com.truehr.app.data.remote.dto.UpdateTaskStatusRequest
import com.truehr.app.domain.model.Task
import com.truehr.app.domain.model.TaskSummary
import com.truehr.app.domain.model.TeamTaskSummary
import com.truehr.app.domain.repository.TaskRepository
import javax.inject.Inject

class TaskRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : TaskRepository {

  private fun TaskDto.toModel() = Task(
    id = id, title = title.orEmpty(), description = description, assignedTo = assignedTo,
    assignedToName = assignedToName, assignedToCode = assignedToCode, assignedByName = assignedByName,
    dueDate = dueDate, aroundTime = aroundTime, status = status ?: "PENDING", remark = remark, createdAt = createdAt,
  )

  override suspend fun mine(status: String?): List<Task> = api.tasks(status = status).map { it.toModel() }

  override suspend fun summary(): TaskSummary =
    api.taskSummary().let { TaskSummary(it.total, it.pending, it.ongoing, it.closed) }

  override suspend fun updateStatus(id: Long, status: String, remark: String?) =
    api.taskStatus(id, UpdateTaskStatusRequest(status, remark))

  override suspend fun create(assignedTo: Long, title: String, description: String?, dueDate: String?, aroundTime: String?) =
    api.taskCreate(CreateTaskRequest(assignedTo, title, description, dueDate, aroundTime))

  override suspend fun team(memberId: Long?, status: String?): List<Task> =
    api.taskTeam(memberId = memberId, status = status).map { it.toModel() }

  override suspend fun teamSummary(): List<TeamTaskSummary> =
    api.taskTeamSummary().map { TeamTaskSummary(it.employeeId, it.employeeCode, it.name, it.total, it.closed, it.pending, it.ongoing) }
}
