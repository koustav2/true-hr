package com.truehr.app

import com.truehr.app.core.Dates
import com.truehr.app.core.Labels
import org.junit.Assert.assertEquals
import org.junit.Test

class DatesLabelsTest {
  @Test fun utcTimestampOfIstMidnightIsTheIstDay() {
    // The API sends 2026-11-10 (IST) as 2026-11-09T18:30:00.000Z.
    assertEquals("2026-11-10", Dates.isoDay("2026-11-09T18:30:00.000Z"))
    assertEquals("10-11-2026", Dates.dmy("2026-11-09T18:30:00.000Z"))
    assertEquals("2026-11-10", Dates.isoDay("2026-11-10"))
  }

  @Test fun dateMath() {
    assertEquals("2026-03-01", Dates.addDays("2026-02-28", 1))
    assertEquals(29, Dates.daysInMonth(2028, 2))
    assertEquals("2008-11-04", Dates.addYears("2026-11-04", -18))
  }

  @Test fun readableStatuses() {
    assertEquals("Pending with reporting manager", Labels.of("Pending-RPT"))
    assertEquals("Cancelled", Labels.of("CANCELLED"))
    assertEquals("In progress", Labels.of("IN_PROGRESS"))
    assertEquals("Full time", Labels.of("FULL_TIME"))
    assertEquals("HR Policy", Labels.of("HR Policy"))
    assertEquals("Not joined", Labels.attendance("NA"))
  }
}
