package com.truehr.app.core

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Parses a Postgres ISO timestamp (UTC) and formats date/time parts in local time. */
object Formats {
  private val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
  private val dayNameFmt = SimpleDateFormat("EEE", Locale.getDefault())
  private val dayNumFmt = SimpleDateFormat("dd", Locale.getDefault())
  private val dateFmt = SimpleDateFormat("yyyy/MM/dd", Locale.getDefault())
  private val timeFmt = SimpleDateFormat("hh:mm:ss a", Locale.getDefault())

  fun parse(iso: String): Date? = runCatching { parser.parse(iso.take(19)) }.getOrNull()

  fun dayName(d: Date) = dayNameFmt.format(d)
  fun dayNum(d: Date) = dayNumFmt.format(d)
  fun date(d: Date) = dateFmt.format(d)
  fun time(d: Date) = timeFmt.format(d)
}
