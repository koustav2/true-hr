package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class CompOffCreditDto(
  val onDutyId: Long,
  val workedFrom: String? = null,
  val workedTo: String? = null,
  val location: String? = null,
  val expiryDate: String? = null,
)

@Serializable
data class ApplyCompOffRequest(
  val onDutyId: Long,
  val leaveDate: String,
  val remark: String? = null,
)

@Serializable
data class CompOffRequestDto(
  val id: Long,
  val employeeCode: String? = null,
  val name: String? = null,
  val workedFrom: String? = null,
  val workedTo: String? = null,
  val location: String? = null,
  val odBalance: Int = 1,
  val leaveDate: String? = null,
  val expiryDate: String? = null,
  val remark: String? = null,
  val status: String? = null,
  val reviewNote: String? = null,
  val appliedAt: String? = null,
  val reviewedAt: String? = null,
)
