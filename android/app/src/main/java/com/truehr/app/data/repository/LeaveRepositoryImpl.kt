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
    LeaveType(
      code = it.code, name = it.name, requiresBalance = it.requiresBalance,
      allowHalfDay = it.allowHalfDay, singleDate = it.singleDate, allowCertificate = it.allowCertificate,
      certificateAfterDays = it.certificateAfterDays,
    )
  }

  override suspend fun balances(): List<LeaveBalance> = api.leaveBalances().map {
    LeaveBalance(
      code = it.code, name = it.name, requiresBalance = it.requiresBalance,
      allocated = it.allocated, used = it.used, remaining = it.remaining,
      pending = it.pending,
      // v2 sends `available`; null there means "no limit" only for LWP.
      available = it.available ?: if (it.requiresBalance) it.remaining - it.pending else null,
    )
  }

  override suspend fun apply(leaveCode: String, fromDate: String, toDate: String, reason: String?, halfDay: Boolean, halfDaySession: String?, certificate: String?, certificateMime: String?, certificateName: String?): String? =
    api.leaveApply(ApplyLeaveRequest(leaveCode = leaveCode, fromDate = fromDate, toDate = toDate, reason = reason, halfDay = halfDay,
      halfDaySession = if (halfDay) halfDaySession else null, certificate = certificate, certificateMime = certificateMime, certificateName = certificateName)).approver

  override suspend fun holidays(year: Int): List<com.truehr.app.domain.model.Holiday> =
    api.leaveHolidays(year).map { com.truehr.app.domain.model.Holiday(it.date.take(10), it.name.orEmpty(), it.kind == "RESTRICTED") }
      .sortedBy { it.date }

  override suspend fun list(status: String): List<LeaveRequest> = api.leaveList(status).map { it.toModel() }
  override suspend fun team(status: String): List<LeaveRequest> = api.leaveTeam(status).map { it.toModel() }

  override suspend fun review(id: Long, decision: String, note: String?) {
    api.leaveReview(id, OdReviewRequest(decision = decision, note = note))
  }
  override suspend fun cancel(id: Long) = api.leaveCancel(id)
}

private fun com.truehr.app.data.remote.dto.LeaveRequestDto.toModel() = LeaveRequest(
  id = id,
  employeeCode = employeeCode.orEmpty(),
  name = name.orEmpty(),
  leaveType = leaveType.orEmpty(),
  leaveCode = leaveCode.orEmpty(),
  // fromIso/toIso are the calendar dates; fromDate is a UTC timestamp of IST midnight.
  fromDate = fromIso ?: com.truehr.app.core.Dates.isoDay(fromDate).orEmpty(),
  toDate = toIso ?: com.truehr.app.core.Dates.isoDay(toDate).orEmpty(),
  days = days,
  halfDay = halfDay,
  reason = reason,
  status = status.orEmpty(),
  reviewNote = reviewNote,
  hasCertificate = hasCertificate,
  certificateUrl = if (hasCertificate) "${com.truehr.app.BuildConfig.BASE_URL}leave/$id/certificate" else null,
  appliedAt = com.truehr.app.core.Dates.isoDay(appliedAt),
  reviewedAt = com.truehr.app.core.Dates.isoDay(reviewedAt),
  halfDaySession = halfDaySession,
  reviewedBy = reviewedBy,
  cancelledAt = cancelledAt,
  cancelledBy = cancelledBy,
  pendingWith = pendingWith,
)
