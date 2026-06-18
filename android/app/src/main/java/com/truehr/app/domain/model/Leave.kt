package com.truehr.app.domain.model

data class LeaveType(val code: String, val name: String, val requiresBalance: Boolean)

data class LeaveBalance(
  val code: String,
  val name: String,
  val requiresBalance: Boolean,
  val allocated: Double,
  val used: Double,
  val remaining: Double,
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
  val reason: String?,
  val status: String,
  val reviewNote: String?,
  val appliedAt: String?,
  val reviewedAt: String?,
)
