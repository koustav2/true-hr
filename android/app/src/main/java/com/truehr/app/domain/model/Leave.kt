package com.truehr.app.domain.model

data class LeaveType(
  val code: String,
  val name: String,
  val requiresBalance: Boolean,
  val allowHalfDay: Boolean = false,
  val singleDate: Boolean = false,
  val allowCertificate: Boolean = false,
  val certificateAfterDays: Double? = null,
)

data class LeaveBalance(
  val code: String,
  val name: String,
  val requiresBalance: Boolean,
  val allocated: Double,
  val used: Double,
  val remaining: Double,
  val pending: Double = 0.0,
  /** What apply allows now (allocated − used − pending); null = no limit (LWP). */
  val available: Double? = remaining,
)

data class LeaveRequest(
  val id: Long,
  val employeeCode: String,
  val name: String,
  val leaveType: String,
  val leaveCode: String,
  val fromDate: String,
  val toDate: String,
  val days: Double,
  val halfDay: Boolean,
  val reason: String?,
  val status: String,
  val reviewNote: String?,
  val hasCertificate: Boolean,
  val certificateUrl: String?,
  val appliedAt: String?,
  val reviewedAt: String?,
  val halfDaySession: String? = null,
  val reviewedBy: String? = null,
  val cancelledAt: String? = null,
  val cancelledBy: String? = null,
  val pendingWith: String? = null,
)

data class Holiday(val date: String, val name: String, val restricted: Boolean)
