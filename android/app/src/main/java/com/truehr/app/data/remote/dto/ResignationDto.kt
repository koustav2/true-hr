package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class ResignationDto(
  val id: Long,
  val employeeCode: String? = null,
  val name: String? = null,
  val designation: String? = null,
  val department: String? = null,
  val location: String? = null,
  val resignationDate: String? = null,
  val lastWorkingDate: String? = null,
  val noticePeriodDays: Int = 30,
  val reason: String? = null,
  val status: String? = null,
  val reviewNote: String? = null,
  val appliedAt: String? = null,
  val reviewedAt: String? = null,
)

@Serializable
data class ResignationEmployeeDto(
  val employeeCode: String? = null,
  val name: String? = null,
  val designation: String? = null,
  val vertical: String? = null,
  val location: String? = null,
  val noticePeriodDays: Int = 30,
)

@Serializable
data class ApproverDto(
  val employeeCode: String? = null,
  val name: String? = null,
  val email: String? = null,
)

@Serializable
data class ResignationContextDto(
  val employee: ResignationEmployeeDto? = null,
  val approvers: List<ApproverDto> = emptyList(),
  val current: ResignationDto? = null,
)

@Serializable
data class ApplyResignationRequest(
  val resignationDate: String,
  val lastWorkingDate: String,
  val reason: String? = null,
)
