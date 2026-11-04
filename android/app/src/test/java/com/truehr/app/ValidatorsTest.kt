package com.truehr.app

import com.truehr.app.core.Validators
import com.truehr.app.core.Validators.LeaveInput
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ValidatorsTest {
  private val today = "2026-11-04"

  // ---- leave (E11, E12, E14) ----
  private fun leave(i: LeaveInput) = Validators.leave(i)
  private val ok = LeaveInput("CL", "Casual Leave", "2026-12-07", "2026-12-07", "Family function", false, null)

  @Test fun leaveValid() = assertTrue(leave(ok).isEmpty())

  @Test fun halfDayOnlyOnOneDateWithASession() {
    val e = leave(ok.copy(toDate = "2026-12-09", halfDay = true))
    assertEquals("Half day is allowed only when From and To are the same date", e["halfDay"])
    assertEquals("Choose First half or Second half", e["halfDaySession"])
    assertTrue(leave(ok.copy(halfDay = true, halfDaySession = "SECOND")).isEmpty())
  }

  @Test fun reasonMandatory() {
    assertEquals("Reason is required", leave(ok.copy(reason = "  "))["reason"])
    assertEquals("Reason must be at least 3 characters", leave(ok.copy(reason = "ab"))["reason"])
  }

  @Test fun datesRequiredAndOrdered() {
    val e = leave(ok.copy(leaveCode = "", fromDate = "", toDate = ""))
    assertEquals("Leave type is required", e["leaveCode"])
    assertEquals("From date is required", e["fromDate"])
    assertEquals("To date cannot be before From date", leave(ok.copy(toDate = "2026-12-01"))["toDate"])
  }

  @Test fun restrictedHolidayOnlyOnListedDays() {
    val rh = ok.copy(leaveCode = "RH", leaveName = "Restricted Holiday", fromDate = "2026-11-18", toDate = "2026-11-18", isRestrictedHoliday = true, restrictedDates = setOf("2026-11-24"))
    assertEquals("18-11-2026 is not a restricted holiday. Pick a date from the restricted holiday list.", leave(rh)["fromDate"])
    assertTrue(leave(rh.copy(fromDate = "2026-11-24", toDate = "2026-11-24")).isEmpty())
  }

  @Test fun wfhWithZeroAllowance() {
    val e = leave(ok.copy(leaveCode = "WFH", leaveName = "Work From Home", allowanceType = true, allowanceLeft = 0.0))
    assertEquals("Work From Home is not allocated to you (0 days)", e["leaveCode"])
  }

  // ---- miss-punch (E7) ----
  @Test fun missPunchRules() {
    var e = Validators.missPunch("0,32,abc", 10, 2026, "09:30", "18:00", "forgot", today)
    assertEquals("0, 32, abc are not days of October 2026 (1–31)", e["days"])
    e = Validators.missPunch("", 10, 2026, "", "", "", today)
    assertEquals("Enter at least one day of the month (e.g. 3 or 3,5)", e["days"])
    assertEquals("In time is required", e["inTime"])
    assertEquals("Out time is required", e["outTime"])
    assertEquals("Remarks is required", e["remarks"])
    e = Validators.missPunch("5", 11, 2026, "09:30", "18:00", "forgot", today)
    assertEquals("Miss-punch is only for past days — 05-11-2026 is today or later", e["days"])
    assertEquals("Day 3 is entered twice", Validators.missPunch("3,3", 11, 2026, "09:30", "18:00", "forgot", today)["days"])
    assertEquals("Out time must be after In time", Validators.missPunch("3", 11, 2026, "18:00", "09:00", "forgot", today)["outTime"])
    assertTrue(Validators.missPunch("2, 3", 11, 2026, "09:30", "18:30", "forgot", today).isEmpty())
  }

  // ---- resignation (E51) ----
  @Test fun resignationRules() {
    val e = Validators.resignation("2026-10-29", "2026-10-20", "", "2026-11-01", "2026-12-04")
    assertEquals("Resignation date cannot be before 01-11-2026", e["resignationDate"])
    assertEquals("Last working date cannot be before the resignation date", e["lastWorkingDate"])
    assertEquals("Reason is required", e["reason"])
    assertEquals("Reason must be at least 5 characters", Validators.resignation(today, "2026-12-04", "bad", null, null)["reason"])
    assertTrue(Validators.resignation(today, "2026-12-04", "Moving to another city", "2026-11-01", "2026-12-04").isEmpty())
  }

  // ---- support (E40/E42) ----
  @Test fun supportRules() {
    val e = Validators.supportTicket("", true, "", "", "")
    assertEquals("Please select an issue type", e["issueType"])
    assertEquals("Please select an issue detail", e["issueDetail"])
    assertEquals("Subject is required", e["subject"])
    assertEquals("Description is required", e["description"])
    assertEquals("Description must be at least 10 characters", Validators.supportTicket("Other", false, "", "Laptop", "hi")["description"])
    assertEquals("Description must be at most 2000 characters", Validators.supportTicket("Other", false, "", "Laptop", "x".repeat(2001))["description"])
    assertEquals("Reply is required", Validators.supportReply(" ")["body"])
  }

  // ---- password (A1) ----
  @Test fun passwordRules() {
    var e = Validators.password("", "abcdefgh", "abcdefgh", requireCurrent = true)
    assertEquals("Enter your current password", e["currentPassword"])
    assertEquals("Password must contain at least one letter and one digit", e["newPassword"])
    assertEquals("Password must be at least 8 characters", Validators.password("", "ab1", "ab1", false)["newPassword"])
    assertEquals("Passwords do not match", Validators.password("Old@1234", "NewPass123", "NewPass12", true)["confirm"])
    assertEquals("Choose a password you have not used here before", Validators.password("Same1234", "Same1234", "Same1234", true)["newPassword"])
    // Forced first change: no current password needed.
    assertTrue(Validators.password("", "NewPass123", "NewPass123", requireCurrent = false).isEmpty())
    // Spaces are part of the password (A7): not trimmed, still valid.
    assertTrue(Validators.password("Old@1234", " NewPass123 ", " NewPass123 ", true).isEmpty())
  }

  // ---- tasks (E32) ----
  @Test fun taskRules() {
    val e = Validators.task(null, "", "", "", "25:99", today)
    assertEquals("Assign to is required", e["assignedTo"])
    assertEquals("Title is required", e["title"])
    assertEquals("Due date is required", e["dueDate"])
    assertEquals("Due time must be a valid time like 17:30", e["aroundTime"])
    assertEquals("Due date cannot be in the past", Validators.task(1, "Report", "", "2026-11-03", "", today)["dueDate"])
    assertEquals("Title must be at least 3 characters", Validators.task(1, "ab", "", today, "", today)["title"])
  }

  // ---- change requests (E59-E61) ----
  @Test fun changeRequestRules() {
    var e = Validators.changeRequest("PROFILE", mapOf("dob" to "2030-01-01", "phone" to "0000000000"), today)
    assertEquals("Date of birth must be in the past and you must be at least 18", e["dob"])
    assertEquals("Phone must be a valid 10-digit mobile number starting with 6-9", e["phone"])
    e = Validators.changeRequest("ADDRESS", mapOf("type" to "CURRENT", "pincode" to "12ab", "city" to "123", "state" to "@@@"), today)
    assertEquals("PIN code is not valid (6 digits)", e["pincode"])
    assertEquals("City should contain letters only", e["city"])
    assertEquals("Choose a state from the list", e["state"])
    assertEquals(Validators.NOTHING_CHANGED, Validators.changeRequest("BANK", emptyMap(), today)["_form"])
    assertTrue(Validators.changeRequest("PROFILE", mapOf("phone" to "+91 98765 43210"), today).isEmpty())
    assertTrue(Validators.changeRequest("ADDRESS", mapOf("type" to "CURRENT", "state" to "odisha", "pincode" to "751001"), today).isEmpty())
  }

  @Test fun onlyChangedFieldsAreSent() {
    val base = mapOf("phone" to "9876543210", "personalEmail" to "a@b.com", "dob" to "1995-01-01", "gender" to "MALE")
    assertTrue(Validators.changedFields(base, base).isEmpty())
    assertEquals(mapOf("phone" to "9123456780"), Validators.changedFields(base + ("phone" to " 9123456780 "), base))
  }

  // ---- address book (E56) ----
  @Test fun directorySearch() {
    assertTrue(Validators.directoryMatches(" aarav ", "Aarav Sharma", "TKF1001", "Operations", "Managing Director"))
    assertTrue(Validators.directoryMatches("engineering", "Sneha Iyer", "TKF1004", "Engineering", "Senior Software Engineer"))
    assertTrue(Validators.directoryMatches("tkf1004", "Sneha Iyer", "TKF1004", null, null))
    assertTrue(!Validators.directoryMatches("zzz", "Sneha Iyer", "TKF1004", "Engineering", "Senior Software Engineer"))
  }

  @Test fun mobileNormalised() {
    assertEquals("9876543210", Validators.normaliseMobile("+91 98765-43210"))
    assertNull(null)
  }
}
