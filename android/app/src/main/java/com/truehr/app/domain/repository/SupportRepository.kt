package com.truehr.app.domain.repository

import com.truehr.app.domain.model.SupportCategoryConfig
import com.truehr.app.domain.model.SupportTicket

interface SupportRepository {
  /** keyed by category: "HR", "IT", "ADMIN" */
  suspend fun catalog(): Map<String, SupportCategoryConfig>
  suspend fun create(category: String, issueType: String, issueDetail: String?, description: String?, attachment: String?, attachmentMime: String?)
  suspend fun list(category: String, from: String?, to: String?): List<SupportTicket>
}
