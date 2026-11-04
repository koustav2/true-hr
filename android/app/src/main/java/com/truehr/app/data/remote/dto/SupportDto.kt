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
  val subject: String? = null,
  val issueType: String,
  val issueDetail: String? = null,
  val description: String? = null,
  val attachment: String? = null,
  val attachmentMime: String? = null,
  val attachmentName: String? = null,
  val confirmDuplicate: Boolean? = null,
)

@Serializable
data class CreateTicketResponse(val ok: Boolean = false, val id: Long? = null, val ticketNo: Long? = null)

@Serializable
data class TicketCommentDto(
  val id: Long? = null,
  val authorRole: String? = null,
  val author: String? = null,
  val body: String? = null,
  val event: String? = null,
  val at: String? = null,
)

@Serializable
data class TicketDetailDto(
  val id: Long,
  val ticketNo: Long? = null,
  val category: String? = null,
  val subject: String? = null,
  val issueType: String? = null,
  val issueDetail: String? = null,
  val description: String? = null,
  val status: String? = null,
  val appliedAt: String? = null,
  val resolvedAt: String? = null,
  val resolutionNote: String? = null,
  val canCancel: Boolean = false,
  val canReopen: Boolean = false,
  val comments: List<TicketCommentDto> = emptyList(),
)

@Serializable
data class TicketCommentRequest(val body: String)

@Serializable
data class TicketReasonRequest(val reason: String? = null)

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
  val ticketNo: Long? = null,
  val subject: String? = null,
  val resolvedAt: String? = null,
  val canCancel: Boolean = false,
  val canReopen: Boolean = false,
  val commentCount: Int = 0,
)
