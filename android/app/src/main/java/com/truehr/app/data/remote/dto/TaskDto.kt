package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class TaskDto(
  val id: Long,
  val title: String? = null,
  val description: String? = null,
  val assignedTo: Long? = null,
  val assignedToName: String? = null,
  val assignedToCode: String? = null,
  val assignedByName: String? = null,
  val dueDate: String? = null,
  val aroundTime: String? = null,
  val status: String? = null,
  val remark: String? = null,
  val createdAt: String? = null,
  val updatedAt: String? = null,
)

@Serializable
data class TaskSummaryDto(
  val total: Int = 0,
  val pending: Int = 0,
  val ongoing: Int = 0,
  val closed: Int = 0,
)

@Serializable
data class TeamTaskSummaryDto(
  val employeeId: Long,
  val employeeCode: String? = null,
  val name: String? = null,
  val total: Int = 0,
  val closed: Int = 0,
  val pending: Int = 0,
  val ongoing: Int = 0,
)

@Serializable
data class CreateTaskRequest(
  val assignedTo: Long,
  val title: String,
  val description: String? = null,
  val dueDate: String? = null,
  val aroundTime: String? = null,
)

@Serializable
data class UpdateTaskStatusRequest(
  val status: String,
  val remark: String? = null,
)
