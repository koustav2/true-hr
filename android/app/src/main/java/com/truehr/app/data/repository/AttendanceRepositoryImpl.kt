package com.truehr.app.data.repository

import com.truehr.app.BuildConfig
import com.truehr.app.core.Formats
import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.AttendanceRecordDto
import com.truehr.app.data.remote.dto.PunchRequest
import com.truehr.app.domain.model.AttendanceDay
import com.truehr.app.domain.model.AttendanceToday
import com.truehr.app.domain.model.MonthCell
import com.truehr.app.domain.model.MonthlyAttendance
import com.truehr.app.domain.model.TeamMember
import com.truehr.app.domain.repository.AttendanceRepository
import java.text.DateFormatSymbols
import java.util.Date
import javax.inject.Inject

private fun photoUrl(id: Long) = "${BuildConfig.BASE_URL}attendance/$id/photo"

class AttendanceRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : AttendanceRepository {

  override suspend fun todayStatus(): AttendanceToday {
    val d = api.attendanceToday()
    return AttendanceToday(punchedIn = d.punchedIn, completed = d.completed)
  }

  override suspend fun punch(type: String, lat: Double?, lng: Double?, address: String?, photoBase64: String?) {
    api.punch(PunchRequest(type = type, lat = lat, lng = lng, address = address, photo = photoBase64))
  }

  /** Groups all punches into one summary per calendar day (earliest IN, latest OUT). */
  override suspend fun daily(year: Int, month: Int, employeeId: Long?): List<AttendanceDay> {
    data class P(val dto: AttendanceRecordDto, val at: Date)
    val parsed = api.attendanceDaily(year, month, employeeId).mapNotNull { dto ->
      Formats.parse(dto.captured_at)?.let { P(dto, it) }
    }
    // Days regularised by an approved miss-punch count as present even if a punch is missing.
    val regularised = runCatching { api.attendanceRegularized(year, month, employeeId).toSet() }.getOrDefault(emptySet())
    return parsed
      .groupBy { Formats.date(it.at) }
      .map { (dateLabel, items) ->
        val sorted = items.sortedBy { it.at.time }
        val ins = sorted.filter { it.dto.type == "IN" }
        val outs = sorted.filter { it.dto.type == "OUT" }
        val firstIn = ins.firstOrNull()
        val lastOut = outs.lastOrNull()
        val any = sorted.first()
        val workHours = if (firstIn != null && lastOut != null && lastOut.at.time > firstIn.at.time) {
          val mins = ((lastOut.at.time - firstIn.at.time) / 60000L).toInt()
          "${mins / 60}h ${mins % 60}m"
        } else null
        AttendanceDay(
          dateLabel = dateLabel,
          dayName = Formats.dayName(any.at),
          dayNum = Formats.dayNum(any.at),
          inTime = firstIn?.let { Formats.time(it.at) },
          inLocation = firstIn?.dto?.address,
          outTime = lastOut?.let { Formats.time(it.at) },
          outLocation = lastOut?.dto?.address,
          present = ins.isNotEmpty(),
          workHours = workHours,
          inPhotoUrl = firstIn?.dto?.takeIf { it.has_photo }?.let { photoUrl(it.id) },
          outPhotoUrl = lastOut?.dto?.takeIf { it.has_photo }?.let { photoUrl(it.id) },
        )
      }
      .sortedByDescending { it.dateLabel }
  }

  override suspend fun monthly(year: Int, month: Int, employeeId: Long?): MonthlyAttendance {
    val dto = api.attendanceMonthly(year, month, employeeId)
    val label = "${DateFormatSymbols().months[(dto.month - 1).coerceIn(0, 11)]} ${dto.year}"
    return MonthlyAttendance(
      monthLabel = label, year = dto.year, month = dto.month,
      cells = dto.days.map { MonthCell(it.day, it.status) },
    )
  }

  override suspend fun team(): List<TeamMember> = api.attendanceTeam().map {
    TeamMember(
      employeeId = it.employeeId ?: 0L,
      name = it.name.orEmpty(),
      employeeCode = it.employeeCode.orEmpty(),
      designation = it.designation,
      punchIn = it.punchIn?.let { iso -> Formats.parse(iso)?.let { d -> Formats.time(d) } },
      punchOut = it.punchOut?.let { iso -> Formats.parse(iso)?.let { d -> Formats.time(d) } },
      status = it.status ?: "N/A",
      held = it.held,
      inPhotoUrl = it.inPhotoId?.let { id -> photoUrl(id) },
      outPhotoUrl = it.outPhotoId?.let { id -> photoUrl(id) },
    )
  }

  override suspend fun holdTeam(employeeId: Long) = api.holdTeam(com.truehr.app.data.remote.dto.HoldRequest(employeeId))
  override suspend fun releaseTeam(employeeId: Long) = api.releaseTeam(com.truehr.app.data.remote.dto.HoldRequest(employeeId))
}
