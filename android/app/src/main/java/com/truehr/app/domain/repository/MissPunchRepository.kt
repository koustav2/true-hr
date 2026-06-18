package com.truehr.app.domain.repository

import com.truehr.app.domain.model.MissPunch

interface MissPunchRepository {
  suspend fun apply(days: String, month: Int, year: Int, remarks: String?)
  suspend fun list(status: String): List<MissPunch>
  suspend fun team(status: String): List<MissPunch>
  suspend fun review(id: Long, decision: String, note: String?)
}
