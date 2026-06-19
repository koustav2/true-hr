package com.truehr.app.domain.model

data class SupportCategoryConfig(
  val types: List<String>,
  val details: Map<String, List<String>>,
  val attachment: Boolean,
)

data class SupportTicket(
  val id: Long,
  val category: String,
  val issueType: String,
  val issueDetail: String?,
  val description: String?,
  val status: String,
  val hasAttachment: Boolean,
  val appliedAt: String?,
  val resolutionNote: String?,
  val name: String,
  val employeeCode: String,
  val email: String?,
  val phone: String?,
)
