package com.truehr.app.domain.repository

import com.truehr.app.domain.model.Resignation
import com.truehr.app.domain.model.ResignationContext

interface ResignationRepository {
  suspend fun context(): ResignationContext
  suspend fun apply(resignationDate: String, lastWorkingDate: String, reason: String?, letter: com.truehr.app.core.PickedFile? = null)
  suspend fun withdraw(id: Long)
  suspend fun team(status: String): List<Resignation>
  suspend fun review(id: Long, decision: String, note: String?)
}
