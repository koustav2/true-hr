package com.truehr.app

import com.truehr.app.data.remote.dto.*
import com.truehr.app.di.AppJson
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Real /api/v2 responses captured from the local backend (src/test/resources/v2). */
class V2DtoDecodingTest {
  private fun res(name: String) = javaClass.classLoader!!.getResource("v2/$name")!!.readText()
  private inline fun <reified T> decode(name: String): T = AppJson.decodeFromString(res(name))

  @Test fun loginUserIdAsStringDecodes() {
    val r: LoginResponse = AppJson.decodeFromString("""{"token":"t","user":{"id":"9","email":"a@b.c","role":"EMPLOYEE","mustChangePassword":true}}""")
    assertEquals(9L, r.user?.id)
    assertTrue(r.user!!.mustChangePassword)
  }

  @Test fun me() {
    val m: MeDto = decode("emp_me.json")
    assertEquals("Sneha Iyer", m.name)
    assertEquals("TKF1004", m.employee_code)
  }

  @Test fun fullProfileIsMasked() {
    val p: FullProfileDto = decode("emp_me_full-profile.json")
    assertEquals("Sneha Iyer", p.fullName)
    assertTrue(p.bank.accountNumberMasked!!.startsWith("•"))
    assertTrue(p.statutory.panMasked!!.startsWith("•"))
    assertEquals(2, p.addresses.size)
  }

  @Test fun directoryHasNoPhone() {
    val d: List<DirectoryEntryDto> = decode("emp_me_directory.json")
    assertTrue(d.isNotEmpty())
    assertTrue(d.all { it.phone == null && it.city == null })
    assertNotNull(d.first().id)
  }

  @Test fun leave() {
    val types: List<LeaveTypeDto> = decode("emp_leave_types.json")
    assertEquals(2.0, types.first { it.code == "SL" }.certificateAfterDays!!, 0.0)
    val bal: List<LeaveBalanceDto> = decode("emp_leave_balances.json")
    val cl = bal.first { it.code == "CL" }
    assertEquals(2.0, cl.pending, 0.0); assertEquals(5.0, cl.available!!, 0.0)
    assertNull(bal.first { it.code == "LWP" }.available)
    val list: List<LeaveRequestDto> = decode("emp_leave_status_PENDING.json")
    assertEquals("2026-11-10", list[0].fromIso)
    assertEquals("Meera Krishnan", list[0].pendingWith)
    val hol: List<HolidayDto> = decode("emp_leave_holidays_year_2026.json")
    assertTrue(hol.isNotEmpty())
  }

  @Test fun missPunch() {
    val p: List<MissPunchDto> = decode("emp_misspunch_status_PENDING.json")
    assertEquals("09:30", p[0].inTime); assertEquals("Meera Krishnan", p[0].pendingWith)
    val c: List<MissPunchDto> = decode("emp_misspunch_status_CANCELLED.json")
    assertNotNull(c[0].cancelledAt)
  }

  @Test fun attendance() {
    val m: MonthlyDto = decode("emp_attendance_monthly_year_2026_month_11.json")
    assertEquals("Diwali", m.days.first { it.status == "H" }.holiday)
    assertEquals(2024, m.minMonth!!.year)
    assertEquals(1, m.holidays.size)
    val daily: List<AttendanceRecordDto> = decode("emp_attendance_daily_year_2026_month_11.json")
    assertTrue(daily.isNotEmpty())
    decode<TodayDto>("emp_attendance_today.json")
    decode<List<TeamMemberDto>>("mgr_attendance_team.json")
    decode<List<TeamMateDto>>("mgr_me_team.json")
  }

  @Test fun resignationContext() {
    val c: ResignationContextDto = decode("emp_resignation_context.json")
    assertFalse(c.canSubmit)
    assertEquals(listOf("Human Resource"), c.missingStages)
    assertEquals("2026-12-03", c.policy!!.suggestedLastWorkingDate)
    assertEquals("Engineering", c.employee!!.department)
    assertEquals("MISSING", c.approvers.last().assignment)
  }

  @Test fun supportAndPolicies() {
    val cat: SupportCatalogDto = decode("emp_support_catalog.json")
    assertTrue(cat.IT.types.contains("Other"))
    assertFalse(cat.ADMIN.types.contains("Others"))
    val t: List<SupportTicketDto> = decode("emp_support_category_IT.json")
    assertEquals(1L, t[0].ticketNo); assertEquals("OPEN", t[0].status); assertTrue(t[0].canCancel)
    decode<TicketDetailDto>("emp_support_detail.json")
    val pol: List<PolicyDto> = decode("emp_policies.json")
    assertNull(pol[0].id) // not uploaded yet: id is null
    assertTrue(pol.any { it.kind == "FORMAT" })
  }

  @Test fun tasksPayslipsTours() {
    val tasks: List<TaskDto> = decode("emp_tasks.json")
    assertEquals(4L, tasks[0].assignedTo)
    decode<TaskSummaryDto>("emp_tasks_summary.json")
    val ps: List<PayslipRowDto> = decode("emp_payslips.json")
    assertTrue(ps.isNotEmpty())
    decode<List<TourDto>>("emp_tours.json")
    decode<List<GeotagDto>>("emp_geotags.json")
    decode<OdEligibilityDto>("emp_onduty_eligibility.json")
    decode<List<CompOffCreditDto>>("emp_compoff_credits.json")
    decode<List<NotificationDto>>("emp_notifications.json")
    decode<UnreadCountDto>("emp_notifications_unread-count.json")
    decode<List<BannerDto>>("emp_banners.json")
  }

  @Test fun explicitNullForDefaultedFieldUsesDefault() {
    // coerceInputValues: "noticePeriodDays": null must not fail the whole response.
    val r: ResignationDto = AppJson.decodeFromString("""{"id":1,"noticePeriodDays":null,"status":"PENDING"}""")
    assertEquals(30, r.noticePeriodDays)
  }
}
