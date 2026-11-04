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
  val department: String? = null,
  val dateOfJoining: String? = null,
  val reportingManager: String? = null,
)

@Serializable
data class ResignationPolicyDto(
  val today: String? = null,
  val minResignationDate: String? = null,
  val maxResignationDate: String? = null,
  val suggestedLastWorkingDate: String? = null,
  val noticePeriodDays: Int = 30,
)

@Serializable
data class ApproverDto(
  val employeeCode: String? = null,
  val name: String? = null,
  val email: String? = null,
  val stage: String? = null,   // e.g. "Reporting Manager"
  val seq: Int? = null,
  val status: String? = null,  // PENDING | APPROVED | REJECTED | BYPASSED | null (not applied yet)
  val assignment: String? = null, // v2 preview: ASSIGNED | SKIPPED | MISSING
)

@Serializable
data class ResignationContextDto(
  val employee: ResignationEmployeeDto? = null,
  val approvers: List<ApproverDto> = emptyList(),
  val current: ResignationDto? = null,
  // v2 (E50/E51)
  val canSubmit: Boolean = true,
  val missingStages: List<String> = emptyList(),
  val policy: ResignationPolicyDto? = null,
)

@Serializable
data class ApplyResignationRequest(
  val resignationDate: String,
  val lastWorkingDate: String,
  val reason: String? = null,
  val letter: String? = null,
  val letterMime: String? = null,
  val letterName: String? = null,
)
