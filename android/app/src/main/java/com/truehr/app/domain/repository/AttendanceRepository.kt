package com.truehr.app.domain.repository

import com.truehr.app.domain.model.AttendanceDay
import com.truehr.app.domain.model.AttendanceToday
import com.truehr.app.domain.model.MonthlyAttendance
import com.truehr.app.domain.model.TeamMember

interface AttendanceRepository {
  suspend fun todayStatus(): AttendanceToday
  suspend fun punch(type: String, lat: Double?, lng: Double?, address: String?, photoBase64: String?)
  suspend fun daily(year: Int, month: Int, employeeId: Long? = null): List<AttendanceDay>
  suspend fun monthly(year: Int, month: Int, employeeId: Long? = null): MonthlyAttendance
  suspend fun team(): List<TeamMember>
  suspend fun holdTeam(employeeId: Long)
  suspend fun releaseTeam(employeeId: Long)
}
