package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.ApplyMissPunchRequest
import com.truehr.app.data.remote.dto.MissPunchDto
import com.truehr.app.domain.model.MissPunch
import com.truehr.app.domain.repository.MissPunchRepository
import javax.inject.Inject

private fun MissPunchDto.toModel() = MissPunch(
  id = id, employeeCode = employeeCode.orEmpty(), name = name.orEmpty(),
  days = days.orEmpty(), month = month.orEmpty(), year = year ?: 0,
  remarks = remarks, status = status.orEmpty(), reviewNote = reviewNote,
  appliedAt = com.truehr.app.core.Dates.isoDay(appliedAt), reviewedAt = com.truehr.app.core.Dates.isoDay(reviewedAt),
  inTime = inTime?.take(5), outTime = outTime?.take(5), cancelledAt = cancelledAt, reviewedBy = reviewedBy, pendingWith = pendingWith,
)

class MissPunchRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : MissPunchRepository {
  override suspend fun apply(days: String, month: Int, year: Int, remarks: String?, inTime: String, outTime: String) {
    api.missPunchApply(ApplyMissPunchRequest(days = days, month = month, year = year, remarks = remarks, inTime = inTime, outTime = outTime))
  }
  override suspend fun cancel(id: Long) = api.missPunchCancel(id)
  override suspend fun list(status: String): List<MissPunch> = api.missPunchList(status).map { it.toModel() }
  override suspend fun team(status: String): List<MissPunch> = api.missPunchTeam(status).map { it.toModel() }
  override suspend fun review(id: Long, decision: String, note: String?) {
    api.missPunchReview(id, com.truehr.app.data.remote.dto.OdReviewRequest(decision = decision, note = note))
  }
}
