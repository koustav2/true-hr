package com.truehr.app.domain.model

data class Task(
  val id: Long,
  val title: String,
  val description: String?,
  val assignedTo: Long?,
  val assignedToName: String?,
  val assignedToCode: String?,
  val assignedByName: String?,
  val dueDate: String?,
  val aroundTime: String?,
  val status: String,
  val remark: String?,
  val createdAt: String?,
)

data class TaskSummary(val total: Int, val pending: Int, val ongoing: Int, val closed: Int)

data class TeamTaskSummary(
  val employeeId: Long,
  val employeeCode: String?,
  val name: String?,
  val total: Int,
  val closed: Int,
  val pending: Int,
  val ongoing: Int,
)
