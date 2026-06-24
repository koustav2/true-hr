package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.ApplyResignationRequest
import com.truehr.app.data.remote.dto.OdReviewRequest
import com.truehr.app.data.remote.dto.ResignationDto
import com.truehr.app.domain.model.Approver
import com.truehr.app.domain.model.Resignation
import com.truehr.app.domain.model.ResignationContext
import com.truehr.app.domain.model.ResignationEmployee
import com.truehr.app.domain.repository.ResignationRepository
import javax.inject.Inject

class ResignationRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : ResignationRepository {

  private fun ResignationDto.toModel() = Resignation(
    id = id, employeeCode = employeeCode, name = name, designation = designation, department = department,
    location = location, resignationDate = resignationDate, lastWorkingDate = lastWorkingDate,
    noticePeriodDays = noticePeriodDays, reason = reason, status = status, reviewNote = reviewNote,
    appliedAt = appliedAt, reviewedAt = reviewedAt,
  )

  override suspend fun context(): ResignationContext {
    val c = api.resignationContext()
    return ResignationContext(
      employee = c.employee?.let {
        ResignationEmployee(it.employeeCode, it.name, it.designation, it.vertical, it.location, it.noticePeriodDays)
      },
      approvers = c.approvers.map { Approver(it.employeeCode, it.name, it.email) },
      current = c.current?.toModel(),
    )
  }

  override suspend fun apply(resignationDate: String, lastWorkingDate: String, reason: String?) =
    api.resignationApply(ApplyResignationRequest(resignationDate, lastWorkingDate, reason))

  override suspend fun withdraw(id: Long) = api.resignationWithdraw(id)

  override suspend fun team(status: String): List<Resignation> = api.resignationTeam(status).map { it.toModel() }

  override suspend fun review(id: Long, decision: String, note: String?) =
    api.resignationReview(id, OdReviewRequest(decision, note))
}
