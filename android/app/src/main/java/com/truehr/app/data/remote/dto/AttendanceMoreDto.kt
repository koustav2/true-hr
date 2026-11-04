package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class MonthDayDto(val day: Int, val status: String? = null, val holiday: String? = null)

@Serializable
data class MonthHolidayDto(val day: Int, val name: String? = null)

@Serializable
data class YearMonthDto(val year: Int, val month: Int)

@Serializable
data class MonthlyDto(
  val year: Int,
  val month: Int,
  val days: List<MonthDayDto> = emptyList(),
  // v2 (E4/E5): joining date, the month's holidays, and the earliest month to open.
  val joiningDate: String? = null,
  val holidays: List<MonthHolidayDto> = emptyList(),
  val minMonth: YearMonthDto? = null,
)

@Serializable
data class TeamMemberDto(
  val employeeId: Long? = null,
  val employeeCode: String? = null,
  val name: String? = null,
  val designation: String? = null,
  val punchIn: String? = null,
  val punchOut: String? = null,
  val inPhotoId: Long? = null,
  val outPhotoId: Long? = null,
  val status: String? = null,
  val held: Boolean = false,
)

@Serializable
data class HoldRequest(val employeeId: Long)

@Serializable
data class TeamMateDto(
  val id: Long? = null,
  val employeeCode: String? = null,
  val name: String? = null,
  val designation: String? = null,
  val department: String? = null,
  val state: String? = null,
  val email: String? = null,
  val phone: String? = null,
  val reportingManager: String? = null,
  val functionalManager: String? = null,
)

@Serializable
data class DirectoryEntryDto(
  val id: Long? = null,
  val employeeCode: String? = null,
  val name: String? = null,
  val designation: String? = null,
  val department: String? = null,
  val email: String? = null,
  val phone: String? = null,
  val city: String? = null,
  val state: String? = null,
  // v2: official work location (branch / posting state); no personal phone (E54).
  val location: String? = null,
)

@Serializable
data class ApplyMissPunchRequest(val days: String, val month: Int, val year: Int, val remarks: String? = null, val inTime: String? = null, val outTime: String? = null)

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
  val reviewNote: String? = null,
  val appliedAt: String? = null,
  val reviewedAt: String? = null,
  val inTime: String? = null,
  val outTime: String? = null,
  val cancelledAt: String? = null,
  val reviewedBy: String? = null,
  val pendingWith: String? = null,
)

@Serializable
data class ApplyOdRequest(
  val fromDate: String,
  val toDate: String,
  val dayType: String,
  val place: String? = null,
  val reason: String? = null,
  val photo: String? = null,
  val lat: Double? = null,
  val lng: Double? = null,
  val address: String? = null,
)

@Serializable
data class OdReviewRequest(val decision: String, val note: String? = null)

@Serializable
data class OdEligibilityDto(val canApply: Boolean = true, val reason: String? = null)

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
