package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.ApplyOdRequest
import com.truehr.app.data.remote.dto.OdDto
import com.truehr.app.data.remote.dto.OdReviewRequest
import com.truehr.app.domain.model.OnDuty
import com.truehr.app.domain.repository.OnDutyRepository
import javax.inject.Inject

private fun OdDto.toModel() = OnDuty(
  id = id, employeeCode = employeeCode.orEmpty(), name = name.orEmpty(),
  fromDate = fromDate?.take(10).orEmpty(), toDate = toDate?.take(10).orEmpty(),
  dayType = dayType.orEmpty(), place = place, reason = reason,
  status = status.orEmpty(), reviewNote = reviewNote,
  appliedAt = appliedAt?.take(10), reviewedAt = reviewedAt?.take(10),
)

class OnDutyRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : OnDutyRepository {
  override suspend fun apply(fromDate: String, toDate: String, dayType: String, place: String?, reason: String?, photo: String?, lat: Double?, lng: Double?, address: String?) {
    api.odApply(ApplyOdRequest(fromDate = fromDate, toDate = toDate, dayType = dayType, place = place, reason = reason, photo = photo, lat = lat, lng = lng, address = address))
  }
  override suspend fun list(status: String): List<OnDuty> = api.odList(status).map { it.toModel() }
  override suspend fun team(status: String): List<OnDuty> = api.odTeam(status).map { it.toModel() }
  override suspend fun review(id: Long, decision: String, note: String?) {
    api.odReview(id, OdReviewRequest(decision = decision, note = note))
  }
}
