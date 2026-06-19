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

  override suspend fun create(category: String, issueType: String, issueDetail: String?, description: String?, attachment: String?, attachmentMime: String?) {
    api.supportCreate(CreateTicketRequest(category, issueType, issueDetail, description, attachment, attachmentMime))
  }

  override suspend fun list(category: String, from: String?, to: String?): List<SupportTicket> =
    api.supportList(category, from, to).map {
      SupportTicket(
        id = it.id, category = it.category.orEmpty(), issueType = it.issueType.orEmpty(), issueDetail = it.issueDetail,
        description = it.description, status = it.status.orEmpty(), hasAttachment = it.hasAttachment,
        appliedAt = it.appliedAt, resolutionNote = it.resolutionNote,
        name = it.name.orEmpty(), employeeCode = it.employeeCode.orEmpty(), email = it.email, phone = it.phone,
      )
    }
}
