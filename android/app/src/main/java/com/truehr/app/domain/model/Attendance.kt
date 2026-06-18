package com.truehr.app.domain.model

/** Today's punch status for the logged-in employee. */
data class AttendanceToday(val punchedIn: Boolean, val completed: Boolean)

/** One day's attendance summary (first punch-in and last punch-out). */
data class AttendanceDay(
  val dateLabel: String,   // 2026/06/17
  val dayName: String,     // Wed
  val dayNum: String,      // 17
  val inTime: String?,     // 03:06:28 PM
  val inLocation: String?,
  val outTime: String?,    // 03:06:47 PM
  val outLocation: String?,
  val present: Boolean,
  val workHours: String? = null,   // e.g. "8h 12m" (in-to-out span)
  val inPhotoUrl: String? = null,  // captured selfie at punch-in
  val outPhotoUrl: String? = null, // captured selfie at punch-out
)
