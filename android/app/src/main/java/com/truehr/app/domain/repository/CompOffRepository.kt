package com.truehr.app.domain.repository

import com.truehr.app.domain.model.CompOffCredit
import com.truehr.app.domain.model.CompOffRequest

interface CompOffRepository {
  suspend fun credits(): List<CompOffCredit>
  suspend fun apply(onDutyId: Long, leaveDate: String, remark: String?)
  suspend fun list(status: String): List<CompOffRequest>
  suspend fun team(status: String): List<CompOffRequest>
  suspend fun review(id: Long, decision: String, note: String?)
}
