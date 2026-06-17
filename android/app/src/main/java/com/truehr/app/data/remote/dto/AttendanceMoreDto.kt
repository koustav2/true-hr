package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class MonthDayDto(val day: Int, val status: String? = null)

@Serializable
data class MonthlyDto(val year: Int, val month: Int, val days: List<MonthDayDto> = emptyList())

@Serializable
data class TeamMemberDto(
  val employeeId: Long? = null,
  val employeeCode: String? = null,
  val name: String? = null,
  val designation: String? = null,
  val punchIn: String? = null,
  val punchOut: String? = null,
  val status: String? = null,
  val held: Boolean = false,
)

@Serializable
data class HoldRequest(val employeeId: Long)

@Serializable
data class ApplyMissPunchRequest(val days: String, val month: Int, val year: Int, val remarks: String? = null)

@Serializable
data class MissPunchDto(
  val id: Long,
  val employeeCode: String? = null,
  val name: String? = null,
  val days: String? = null,
  val month: String? = null,
  val year: Int? = null,
  val remarks: String? = null,
  val status: String? = null,
  val appliedAt: String? = null,
  val reviewedAt: String? = null,
)

@Serializable
data class ApplyOdRequest(
  val fromDate: String,
  val toDate: String,
  val dayType: String,
  val place: String? = null,
  val reason: String? = null,
)

@Serializable
data class OdReviewRequest(val decision: String, val note: String? = null)

@Serializable
data class OdDto(
  val id: Long,
  val employeeCode: String? = null,
  val name: String? = null,
  val fromDate: String? = null,
  val toDate: String? = null,
  val dayType: String? = null,
  val place: String? = null,
  val reason: String? = null,
  val status: String? = null,
  val reviewNote: String? = null,
  val appliedAt: String? = null,
  val reviewedAt: String? = null,
)
