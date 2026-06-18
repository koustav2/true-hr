package com.truehr.app.domain.model

data class MonthCell(val day: Int, val status: String?)   // status: P/WO/A/L/H or null

data class MonthlyAttendance(val monthLabel: String, val year: Int, val month: Int, val cells: List<MonthCell>)

data class TeamMember(
  val employeeId: Long,
  val name: String,
  val employeeCode: String,
  val designation: String?,
  val punchIn: String?,
  val punchOut: String?,
  val status: String,
  val held: Boolean,
  val inPhotoUrl: String? = null,
  val outPhotoUrl: String? = null,
)

data class MissPunch(
  val id: Long,
  val employeeCode: String,
  val name: String,
  val days: String,
  val month: String,
  val year: Int,
  val remarks: String?,
  val status: String,
  val reviewNote: String? = null,
  val appliedAt: String?,
  val reviewedAt: String?,
)

data class TeamMate(
  val employeeCode: String,
  val name: String,
  val designation: String?,
  val department: String?,
  val email: String?,
  val phone: String?,
  val reportingManager: String? = null,
  val functionalManager: String? = null,
)

data class DirectoryEntry(
  val employeeCode: String,
  val name: String,
  val designation: String?,
  val department: String?,
  val email: String?,
  val phone: String?,
  val city: String?,
  val state: String?,
)

data class OnDuty(
  val id: Long,
  val employeeCode: String,
  val name: String,
  val fromDate: String,
  val toDate: String,
  val dayType: String,   // FULL | HALF
  val place: String?,
  val reason: String?,
  val status: String,
  val reviewNote: String?,
  val appliedAt: String?,
  val reviewedAt: String?,
)
