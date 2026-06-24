package com.truehr.app.domain.repository

import com.truehr.app.domain.model.Task
import com.truehr.app.domain.model.TaskSummary
import com.truehr.app.domain.model.TeamTaskSummary

interface TaskRepository {
  suspend fun mine(status: String?): List<Task>
  suspend fun summary(): TaskSummary
  suspend fun updateStatus(id: Long, status: String, remark: String?)
  suspend fun create(assignedTo: Long, title: String, description: String?, dueDate: String?, aroundTime: String?)
  suspend fun team(memberId: Long?, status: String?): List<Task>
  suspend fun teamSummary(): List<TeamTaskSummary>
}
