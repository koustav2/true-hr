package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class LeaveTypeDto(
  val code: String,
  val name: String,
  val annualQuota: Double = 0.0,
  val requiresBalance: Boolean = true,
  val allowHalfDay: Boolean = false,
  val singleDate: Boolean = false,
  val allowCertificate: Boolean = false,
  val eligibility: String? = null,
  val certificateAfterDays: Double? = null,
)

@Serializable
data class LeaveBalanceDto(
  val code: String,
  val name: String,
  val requiresBalance: Boolean = true,
  val allocated: Double = 0.0,
  val used: Double = 0.0,
  val remaining: Double = 0.0,
  // v2 (E13/E14): pending days and what can actually be applied for now.
  val pending: Double = 0.0,
  val available: Double? = null,
  val basis: String? = null,
)

@Serializable
data class ApplyLeaveRequest(
  val leaveCode: String,
  val fromDate: String,
  val toDate: String,
  val reason: String? = null,
  val halfDay: Boolean = false,
  val halfDaySession: String? = null,
  val certificate: String? = null,
  val certificateMime: String? = null,
  val certificateName: String? = null,
)

@Serializable
data class ApplyLeaveResponse(
  val ok: Boolean = false,
  val id: Long? = null,
  val days: Double? = null,
  val sandwichDays: Double = 0.0,
  val approver: String? = null,
)

@Serializable
data class HolidayDto(
  val date: String,
  val name: String? = null,
  val state: String? = null,
  val location: String? = null,
  val kind: String? = null,
)

@Serializable
data class LeaveRequestDto(
  val id: Long,
  val employeeCode: String? = null,
  val name: String? = null,
  val leaveType: String? = null,
  val leaveCode: String? = null,
  val fromDate: String? = null,
  val toDate: String? = null,
  val days: Double = 0.0,
  val halfDay: Boolean = false,
  val reason: String? = null,
  val status: String? = null,
  val reviewNote: String? = null,
  val hasCertificate: Boolean = false,
  val appliedAt: String? = null,
  val reviewedAt: String? = null,
  val fromIso: String? = null,
  val toIso: String? = null,
  val halfDaySession: String? = null,
  val sandwichDays: Double = 0.0,
  val reviewedBy: String? = null,
  val cancelledAt: String? = null,
  val cancelledBy: String? = null,
  val pendingWith: String? = null,
  val pendingWithKind: String? = null,
)
