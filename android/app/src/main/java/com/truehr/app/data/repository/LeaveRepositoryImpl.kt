package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.ApplyLeaveRequest
import com.truehr.app.data.remote.dto.OdReviewRequest
import com.truehr.app.domain.model.LeaveBalance
import com.truehr.app.domain.model.LeaveRequest
import com.truehr.app.domain.model.LeaveType
import com.truehr.app.domain.repository.LeaveRepository
import javax.inject.Inject

class LeaveRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : LeaveRepository {

  override suspend fun types(): List<LeaveType> = api.leaveTypes().map {
    LeaveType(code = it.code, name = it.name, requiresBalance = it.requiresBalance)
  }

  override suspend fun balances(): List<LeaveBalance> = api.leaveBalances().map {
    LeaveBalance(
      code = it.code, name = it.name, requiresBalance = it.requiresBalance,
      allocated = it.allocated, used = it.used, remaining = it.remaining,
    )
  }

  override suspend fun apply(leaveCode: String, fromDate: String, toDate: String, reason: String?) {
    api.leaveApply(ApplyLeaveRequest(leaveCode = leaveCode, fromDate = fromDate, toDate = toDate, reason = reason))
  }

  override suspend fun list(status: String): List<LeaveRequest> = api.leaveList(status).map { it.toModel() }
  override suspend fun team(status: String): List<LeaveRequest> = api.leaveTeam(status).map { it.toModel() }

  override suspend fun review(id: Long, decision: String, note: String?) {
    api.leaveReview(id, OdReviewRequest(decision = decision, note = note))
  }
}

private fun com.truehr.app.data.remote.dto.LeaveRequestDto.toModel() = LeaveRequest(
  id = id,
  employeeCode = employeeCode.orEmpty(),
  name = name.orEmpty(),
  leaveType = leaveType.orEmpty(),
  leaveCode = leaveCode.orEmpty(),
  fromDate = fromDate?.take(10).orEmpty(),
  toDate = toDate?.take(10).orEmpty(),
  days = days,
  reason = reason,
  status = status.orEmpty(),
  reviewNote = reviewNote,
  appliedAt = appliedAt?.take(10),
  reviewedAt = reviewedAt?.take(10),
)
