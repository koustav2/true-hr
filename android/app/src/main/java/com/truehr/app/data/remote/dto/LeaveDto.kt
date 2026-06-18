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
)

@Serializable
data class LeaveBalanceDto(
  val code: String,
  val name: String,
  val requiresBalance: Boolean = true,
  val allocated: Double = 0.0,
  val used: Double = 0.0,
  val remaining: Double = 0.0,
)

@Serializable
data class ApplyLeaveRequest(
  val leaveCode: String,
  val fromDate: String,
  val toDate: String,
  val reason: String? = null,
  val halfDay: Boolean = false,
  val certificate: String? = null,
  val certificateMime: String? = null,
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
)
