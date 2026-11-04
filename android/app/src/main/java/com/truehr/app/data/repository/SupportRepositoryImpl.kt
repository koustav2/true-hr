package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.CreateTicketRequest
import com.truehr.app.data.remote.dto.SupportCatDto
import com.truehr.app.domain.model.SupportCategoryConfig
import com.truehr.app.domain.model.SupportTicket
import com.truehr.app.domain.repository.SupportRepository
import javax.inject.Inject

class SupportRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : SupportRepository {

  override suspend fun catalog(): Map<String, SupportCategoryConfig> {
    val c = api.supportCatalog()
    fun map(d: SupportCatDto) = SupportCategoryConfig(d.types, d.details, d.attachment)
    return mapOf("HR" to map(c.HR), "IT" to map(c.IT), "ADMIN" to map(c.ADMIN))
  }

  override suspend fun create(category: String, subject: String, issueType: String, issueDetail: String?, description: String, attachment: String?, attachmentMime: String?, attachmentName: String?): Long? {
    val r = api.supportCreate(CreateTicketRequest(category = category, subject = subject, issueType = issueType, issueDetail = issueDetail,
      description = description, attachment = attachment, attachmentMime = attachmentMime, attachmentName = attachmentName))
    return r.ticketNo ?: r.id
  }

  override suspend fun detail(id: Long): com.truehr.app.domain.model.TicketDetail {
    val d = api.supportDetail(id)
    return com.truehr.app.domain.model.TicketDetail(
      ticket = SupportTicket(
        id = d.id, category = d.category.orEmpty(), issueType = d.issueType.orEmpty(), issueDetail = d.issueDetail,
        description = d.description, status = d.status.orEmpty(), hasAttachment = false, appliedAt = d.appliedAt,
        resolutionNote = d.resolutionNote, name = "", employeeCode = "", email = null, phone = null,
        ticketNo = d.ticketNo, subject = d.subject, canCancel = d.canCancel, canReopen = d.canReopen,
      ),
      comments = d.comments.map { com.truehr.app.domain.model.TicketComment(it.author ?: "—", it.body.orEmpty(), it.event, it.at) },
    )
  }

  override suspend fun reply(id: Long, body: String) = api.supportComment(id, com.truehr.app.data.remote.dto.TicketCommentRequest(body))
  override suspend fun cancel(id: Long, reason: String?) = api.supportCancel(id, com.truehr.app.data.remote.dto.TicketReasonRequest(reason))
  override suspend fun reopen(id: Long, reason: String) = api.supportReopen(id, com.truehr.app.data.remote.dto.TicketReasonRequest(reason))

  override suspend fun list(category: String, from: String?, to: String?): List<SupportTicket> =
    api.supportList(category, from, to).map {
      SupportTicket(
        id = it.id, category = it.category.orEmpty(), issueType = it.issueType.orEmpty(), issueDetail = it.issueDetail,
        description = it.description, status = it.status.orEmpty(), hasAttachment = it.hasAttachment,
        appliedAt = it.appliedAt, resolutionNote = it.resolutionNote,
        name = it.name.orEmpty(), employeeCode = it.employeeCode.orEmpty(), email = it.email, phone = it.phone,
        ticketNo = it.ticketNo, subject = it.subject, canCancel = it.canCancel, canReopen = it.canReopen,
      )
    }
}
