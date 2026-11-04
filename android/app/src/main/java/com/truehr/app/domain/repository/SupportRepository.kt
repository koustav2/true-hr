package com.truehr.app.domain.repository

import com.truehr.app.domain.model.SupportCategoryConfig
import com.truehr.app.domain.model.SupportTicket

interface SupportRepository {
  /** keyed by category: "HR", "IT", "ADMIN" */
  suspend fun catalog(): Map<String, SupportCategoryConfig>
  /** Returns the ticket number. */
  suspend fun create(category: String, subject: String, issueType: String, issueDetail: String?, description: String, attachment: String?, attachmentMime: String?, attachmentName: String?): Long?
  suspend fun detail(id: Long): com.truehr.app.domain.model.TicketDetail
  suspend fun reply(id: Long, body: String)
  suspend fun cancel(id: Long, reason: String?)
  suspend fun reopen(id: Long, reason: String)
  suspend fun list(category: String, from: String?, to: String?): List<SupportTicket>
}
