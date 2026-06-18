package com.truehr.app.domain.model

data class CompOffCredit(
  val onDutyId: Long,
  val workedFrom: String,
  val workedTo: String,
  val location: String?,
  val expiryDate: String,
)

data class CompOffRequest(
  val id: Long,
  val employeeCode: String,
  val name: String,
  val workedFrom: String,
  val workedTo: String,
  val location: String?,
  val odBalance: Int,
  val leaveDate: String,
  val expiryDate: String,
  val remark: String?,
  val status: String,
  val reviewNote: String?,
  val appliedAt: String?,
)
