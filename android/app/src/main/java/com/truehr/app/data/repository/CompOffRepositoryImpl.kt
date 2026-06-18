package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.ApplyCompOffRequest
import com.truehr.app.data.remote.dto.OdReviewRequest
import com.truehr.app.domain.model.CompOffCredit
import com.truehr.app.domain.model.CompOffRequest
import com.truehr.app.domain.repository.CompOffRepository
import javax.inject.Inject

class CompOffRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : CompOffRepository {

  override suspend fun credits(): List<CompOffCredit> = api.compOffCredits().map {
    CompOffCredit(
      onDutyId = it.onDutyId,
      workedFrom = it.workedFrom?.take(10).orEmpty(),
      workedTo = it.workedTo?.take(10).orEmpty(),
      location = it.location,
      expiryDate = it.expiryDate?.take(10).orEmpty(),
    )
  }

  override suspend fun apply(onDutyId: Long, leaveDate: String, remark: String?) {
    api.compOffApply(ApplyCompOffRequest(onDutyId = onDutyId, leaveDate = leaveDate, remark = remark))
  }

  override suspend fun list(status: String): List<CompOffRequest> = api.compOffList(status).map { it.toModel() }
  override suspend fun team(status: String): List<CompOffRequest> = api.compOffTeam(status).map { it.toModel() }

  override suspend fun review(id: Long, decision: String, note: String?) {
    api.compOffReview(id, OdReviewRequest(decision = decision, note = note))
  }
}

private fun com.truehr.app.data.remote.dto.CompOffRequestDto.toModel() = CompOffRequest(
  id = id,
  employeeCode = employeeCode.orEmpty(),
  name = name.orEmpty(),
  workedFrom = workedFrom?.take(10).orEmpty(),
  workedTo = workedTo?.take(10).orEmpty(),
  location = location,
  odBalance = odBalance,
  leaveDate = leaveDate?.take(10).orEmpty(),
  expiryDate = expiryDate?.take(10).orEmpty(),
  remark = remark,
  status = status.orEmpty(),
  reviewNote = reviewNote,
  appliedAt = appliedAt?.take(10),
)
