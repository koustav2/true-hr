package com.truehr.app.core

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Date helpers without java.time (minSdk 24). The API sends calendar dates either
 * as "2026-11-10" or as a UTC timestamp of IST midnight ("2026-11-09T18:30:00.000Z");
 * taking the first 10 characters of the latter shows the previous day.
 */
object Dates {
  private val IST: TimeZone = TimeZone.getTimeZone("Asia/Kolkata")
  private val UTC: TimeZone = TimeZone.getTimeZone("UTC")

  private fun fmt(p: String, tz: TimeZone) = SimpleDateFormat(p, Locale.US).apply { timeZone = tz; isLenient = false }

  /** Calendar day (yyyy-MM-dd) of an API value, read in India time. */
  fun isoDay(raw: String?): String? {
    if (raw.isNullOrBlank()) return null
    if (!raw.contains('T')) return raw.take(10)
    val d = parseInstant(raw) ?: return raw.take(10)
    return fmt("yyyy-MM-dd", IST).format(d)
  }

  /** Parses an ISO instant ("…Z" / with millis) as UTC. */
  fun parseInstant(raw: String): Date? = runCatching { fmt("yyyy-MM-dd'T'HH:mm:ss", UTC).parse(raw.take(19)) }.getOrNull()

  /** dd-MM-yyyy for display (the web uses the same). */
  fun dmy(raw: String?): String {
    val iso = isoDay(raw) ?: return "—"
    val p = iso.split("-")
    return if (p.size == 3) "${p[2]}-${p[1]}-${p[0]}" else iso
  }

  /** dd-MM-yyyy, hh:mm a of an instant, in India time. */
  fun dmyTime(raw: String?): String {
    if (raw.isNullOrBlank()) return "—"
    val d = parseInstant(raw) ?: return dmy(raw)
    return fmt("dd-MM-yyyy, hh:mm a", IST).format(d)
  }

  /** Today in India time as yyyy-MM-dd (never the UTC date). */
  fun todayIso(now: Date = Date()): String = fmt("yyyy-MM-dd", IST).format(now)

  fun isValidIso(iso: String?): Boolean =
    iso != null && Regex("""\d{4}-\d{2}-\d{2}""").matches(iso) && runCatching { fmt("yyyy-MM-dd", UTC).parse(iso) }.getOrNull() != null

  fun addDays(iso: String, n: Int): String {
    val c = Calendar.getInstance(UTC).apply { time = fmt("yyyy-MM-dd", UTC).parse(iso)!!; add(Calendar.DAY_OF_MONTH, n) }
    return fmt("yyyy-MM-dd", UTC).format(c.time)
  }

  fun addYears(iso: String, n: Int): String {
    val c = Calendar.getInstance(UTC).apply { time = fmt("yyyy-MM-dd", UTC).parse(iso)!!; add(Calendar.YEAR, n) }
    return fmt("yyyy-MM-dd", UTC).format(c.time)
  }

  fun daysInMonth(year: Int, month: Int): Int =
    Calendar.getInstance(UTC).apply { clear(); set(year, month - 1, 1) }.getActualMaximum(Calendar.DAY_OF_MONTH)

  fun iso(year: Int, month: Int, day: Int) = "%04d-%02d-%02d".format(year, month, day)

  /** Date-picker millis (UTC midnight) → yyyy-MM-dd. */
  fun fromPickerMillis(ms: Long): String = fmt("yyyy-MM-dd", UTC).format(Date(ms))

  /** yyyy-MM-dd → date-picker millis (UTC midnight). */
  fun toPickerMillis(iso: String): Long? = runCatching { fmt("yyyy-MM-dd", UTC).parse(iso)!!.time }.getOrNull()
}
