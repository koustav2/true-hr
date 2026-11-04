package com.truehr.app.domain.model

data class MonthCell(val day: Int, val status: String?, val holiday: String? = null)   // status: P/WO/A/L/H/NA or null

data class MonthlyAttendance(
  val monthLabel: String, val year: Int, val month: Int, val cells: List<MonthCell>,
  val holidays: List<Pair<Int, String>> = emptyList(),
  /** Earliest month that can be opened (joining month), as year*12+month-1; null = no limit. */
  val minIndex: Int? = null,
)

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
  val inTime: String? = null,
  val outTime: String? = null,
  val cancelledAt: String? = null,
  val reviewedBy: String? = null,
  val pendingWith: String? = null,
)

data class TeamMate(
  val id: Long,
  val employeeCode: String,
  val name: String,
  val designation: String?,
  val department: String?,
  val state: String?,
  val email: String?,
  val phone: String?,
  val reportingManager: String? = null,
  val functionalManager: String? = null,
)

data class DirectoryEntry(
  val id: Long? = null,
  val employeeCode: String,
  val name: String,
  val designation: String?,
  val department: String?,
  val email: String?,
  /** Official work location (branch / posting state). No personal phone (E54). */
  val location: String?,
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
