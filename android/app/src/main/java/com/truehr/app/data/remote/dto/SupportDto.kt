package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class SupportCatDto(
  val types: List<String> = emptyList(),
  val details: Map<String, List<String>> = emptyMap(),
  val attachment: Boolean = false,
)

@Serializable
data class SupportCatalogDto(
  val HR: SupportCatDto = SupportCatDto(),
  val IT: SupportCatDto = SupportCatDto(),
  val ADMIN: SupportCatDto = SupportCatDto(),
)

@Serializable
data class CreateTicketRequest(
  val category: String,
  val issueType: String,
  val issueDetail: String? = null,
  val description: String? = null,
  val attachment: String? = null,
  val attachmentMime: String? = null,
)

@Serializable
data class SupportTicketDto(
  val id: Long,
  val category: String? = null,
  val issueType: String? = null,
  val issueDetail: String? = null,
  val description: String? = null,
  val status: String? = null,
  val hasAttachment: Boolean = false,
  val appliedAt: String? = null,
  val resolutionNote: String? = null,
  val name: String? = null,
  val employeeCode: String? = null,
  val email: String? = null,
  val phone: String? = null,
)
