package com.truehr.app.core

/** Readable text for API codes — never show raw enums like PENDING_RPT or FULL_TIME (E3). */
object Labels {
  private val known = mapOf(
    "PENDING" to "Pending",
    "APPROVED" to "Approved",
    "REJECTED" to "Rejected",
    "CANCELLED" to "Cancelled",
    "WITHDRAWN" to "Withdrawn",
    "BYPASSED" to "Skipped",
    "SKIPPED" to "Will be skipped",
    "MISSING" to "Not assigned (required)",
    "ASSIGNED" to "Assigned",
    "OPEN" to "Open",
    "IN_PROGRESS" to "In progress",
    "ONGOING" to "In progress",
    "RESOLVED" to "Resolved",
    "CLOSED" to "Closed",
    "REOPENED" to "Reopened",
    "COMPLETED" to "Completed",
    "ACTIVE" to "Active",
    "ENDED" to "Ended",
    "FULL_TIME" to "Full time",
    "PART_TIME" to "Part time",
    "MALE" to "Male",
    "FEMALE" to "Female",
    "OTHER" to "Other",
    "CURRENT" to "Current address",
    "PERMANENT" to "Permanent address",
    "PROFILE" to "Personal details",
    "ADDRESS" to "Address",
    "BANK" to "Bank account",
    "FIRST" to "First half",
    "SECOND" to "Second half",
    "FULL" to "Full day",
    "HALF" to "Half day",
    "PENDING-RPT" to "Pending with reporting manager",
    "PENDING_RPT" to "Pending with reporting manager",
    "RM_PENDING" to "Pending with reporting manager",
    "HR" to "HR",
    "IT" to "IT",
    "ADMIN" to "Admin",
  )

  fun of(code: String?): String {
    if (code.isNullOrBlank()) return "—"
    val key = code.trim().uppercase()
    known[key]?.let { return it }
    // Already readable text ("HR Policy", "Pending with HR") is shown as it is.
    if (code.any { it.isLowerCase() }) return code.trim()
    return key.replace('_', ' ').replace('-', ' ').lowercase().replaceFirstChar { it.uppercase() }
  }

  /** Attendance calendar cell code → word. */
  fun attendance(code: String?): String = when (code) {
    "P" -> "Present"; "A" -> "Absent"; "L" -> "Leave"; "WO" -> "Week off"; "H" -> "Holiday"
    "NA" -> "Not joined"; null -> "—"; else -> of(code)
  }
}
