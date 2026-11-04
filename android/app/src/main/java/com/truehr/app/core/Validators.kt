package com.truehr.app.core

/**
 * Client-side form rules. They mirror the v2 server rules (backend/src/utils/validate.js
 * and the controllers) word for word, so a person sees the same message before and after
 * submitting. Every function returns ALL problems at once as field → message.
 * Pure Kotlin (no Android types) so they are unit-tested on the JVM.
 */
object Validators {
  private val NAME = Regex("^[A-Za-z][A-Za-z .'-]*$")
  private val MOBILE = Regex("^[6-9]\\d{9}$")
  private val EMAIL = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$")
  private val PIN = Regex("^[1-9]\\d{5}$")
  private val IFSC = Regex("^[A-Z]{4}0[A-Z0-9]{6}$")
  private val TIME = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
  private val PLACE = Regex("^[A-Za-z][A-Za-z .,'()-]*$")
  private val MONTHS = listOf("January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December")

  val INDIAN_STATES = listOf("Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
    "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep",
    "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab",
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal")

  private class V {
    val fields = LinkedHashMap<String, String>()
    fun add(k: String, m: String) { if (k !in fields) fields[k] = m }
    fun has(k: String) = k in fields
    fun text(k: String, v: String?, label: String, required: Boolean = false, min: Int = 0, max: Int = 2000) {
      val s = v?.trim().orEmpty()
      if (s.isEmpty()) { if (required) add(k, "$label is required"); return }
      if (s.length < min) add(k, "$label must be at least $min characters")
      if (s.length > max) add(k, "$label must be at most $max characters")
      if (!s.any { it.isLetterOrDigit() }) add(k, "$label must contain letters or digits")
    }
  }

  /** "+91 98765 43210", "09876543210" → "9876543210" (same as the server). */
  fun normaliseMobile(v: String?): String {
    val d = v.orEmpty().replace(" ", "").replace("-", "")
    if (Regex("^\\d{10}$").matches(d)) return d
    return Regex("^(?:\\+?91|0)(\\d{10})$").find(d)?.groupValues?.get(1) ?: d
  }

  // ---------------------------------------------------------------- password
  /** [requireCurrent] = a voluntary change (the server then needs the current password). */
  fun password(current: String, new: String, confirm: String, requireCurrent: Boolean): Map<String, String> {
    val v = V()
    if (requireCurrent && current.isEmpty()) v.add("currentPassword", "Enter your current password")
    when {
      new.isEmpty() -> v.add("newPassword", "New password is required")
      new.length < 8 -> v.add("newPassword", "Password must be at least 8 characters")
      new.length > 128 -> v.add("newPassword", "Password must be at most 128 characters")
      !new.any { it.isLetter() } || !new.any { it.isDigit() } -> v.add("newPassword", "Password must contain at least one letter and one digit")
      requireCurrent && current.isNotEmpty() && current == new -> v.add("newPassword", "Choose a password you have not used here before")
    }
    if (confirm != new) v.add("confirm", "Passwords do not match")
    return v.fields
  }

  // ---------------------------------------------------------------- leave
  data class LeaveInput(
    val leaveCode: String,
    val leaveName: String = "",
    val fromDate: String,
    val toDate: String,
    val reason: String,
    val halfDay: Boolean,
    val halfDaySession: String?,
    val allowHalfDay: Boolean = true,
    val isRestrictedHoliday: Boolean = false,
    val restrictedDates: Set<String> = emptySet(),
    /** Non-deducting type other than LWP (e.g. Work From Home) and its yearly allowance left. */
    val allowanceType: Boolean = false,
    val allowanceLeft: Double? = null,
  )

  fun leave(i: LeaveInput): Map<String, String> {
    val v = V()
    if (i.leaveCode.isBlank()) v.add("leaveCode", "Leave type is required")
    if (i.fromDate.isBlank()) v.add("fromDate", "From date is required")
    else if (!Dates.isValidIso(i.fromDate)) v.add("fromDate", "From date is not a valid date")
    if (i.toDate.isBlank()) v.add("toDate", "To date is required")
    else if (!Dates.isValidIso(i.toDate)) v.add("toDate", "To date is not a valid date")
    if (!v.has("fromDate") && !v.has("toDate") && i.toDate < i.fromDate) v.add("toDate", "To date cannot be before From date")
    v.text("reason", i.reason, "Reason", required = true, min = 3, max = 500)
    if (i.halfDay) {
      val name = i.leaveName.ifBlank { "This leave type" }
      if (!i.allowHalfDay) v.add("halfDay", "$name cannot be taken as a half day")
      else if (i.fromDate.isNotBlank() && i.toDate.isNotBlank() && i.fromDate != i.toDate) {
        v.add("halfDay", "Half day is allowed only when From and To are the same date")
      }
      if (i.halfDaySession !in setOf("FIRST", "SECOND")) v.add("halfDaySession", "Choose First half or Second half")
    }
    if (i.isRestrictedHoliday && !v.has("fromDate") && i.fromDate.isNotBlank()) {
      if (i.toDate.isNotBlank() && i.fromDate != i.toDate) v.add("toDate", "Restricted Holiday is taken for one listed day at a time")
      else if (i.fromDate !in i.restrictedDates) {
        v.add("fromDate", "${Dates.dmy(i.fromDate)} is not a restricted holiday. Pick a date from the restricted holiday list.")
      }
    }
    if (i.allowanceType && (i.allowanceLeft ?: 0.0) <= 0.0 && i.leaveCode.isNotBlank()) {
      v.add("leaveCode", "${i.leaveName.ifBlank { "This leave type" }} is not allocated to you (0 days)")
    }
    return v.fields
  }

  // ---------------------------------------------------------------- miss-punch
  fun missPunch(days: String, month: Int, year: Int?, inTime: String, outTime: String, remarks: String, today: String): Map<String, String> {
    val v = V()
    val tokens = days.split(',').map { it.trim() }.filter { it.isNotEmpty() }
    if (tokens.isEmpty()) v.add("days", "Enter at least one day of the month (e.g. 3 or 3,5)")
    if (month !in 1..12) v.add("month", "Month is required")
    if (year == null) v.add("year", "Year is required") else if (year !in 2000..2100) v.add("year", "Year cannot be less than 2000")
    when {
      inTime.isBlank() -> v.add("inTime", "In time is required")
      !TIME.matches(inTime.trim()) -> v.add("inTime", "In time must be like 09:30")
    }
    when {
      outTime.isBlank() -> v.add("outTime", "Out time is required")
      !TIME.matches(outTime.trim()) -> v.add("outTime", "Out time must be like 18:00")
    }
    if (!v.has("inTime") && !v.has("outTime") && outTime.trim() <= inTime.trim()) v.add("outTime", "Out time must be after In time")
    v.text("remarks", remarks, "Remarks", required = true, min = 3, max = 500)
    if (tokens.isNotEmpty() && year != null && month in 1..12) {
      val dim = Dates.daysInMonth(year, month)
      val bad = tokens.filter { t -> !Regex("^\\d{1,2}$").matches(t) || t.toInt() !in 1..dim }
      if (bad.isNotEmpty()) {
        v.add("days", "${bad.joinToString(", ")} ${if (bad.size == 1) "is not a day" else "are not days"} of ${MONTHS[month - 1]} $year (1–$dim)")
      } else {
        val nums = tokens.map { it.toInt() }
        val dup = nums.filterIndexed { idx, n -> nums.indexOf(n) != idx }.distinct()
        if (dup.isNotEmpty()) v.add("days", "Day ${dup.joinToString(", ")} is entered twice")
        else {
          val future = nums.distinct().sorted().map { Dates.iso(year, month, it) }.filter { it >= today }
          if (future.isNotEmpty()) {
            v.add("days", "Miss-punch is only for past days — ${future.joinToString(", ") { Dates.dmy(it) }} ${if (future.size == 1) "is" else "are"} today or later")
          }
        }
      }
    }
    return v.fields
  }

  // ---------------------------------------------------------------- resignation
  fun resignation(resignationDate: String, lastWorkingDate: String, reason: String, minDate: String?, maxDate: String?): Map<String, String> {
    val v = V()
    if (resignationDate.isBlank()) v.add("resignationDate", "Resignation date is required")
    else if (!Dates.isValidIso(resignationDate)) v.add("resignationDate", "Resignation date is not a valid date")
    else {
      if (minDate != null && resignationDate < minDate) v.add("resignationDate", "Resignation date cannot be before ${Dates.dmy(minDate)}")
      if (maxDate != null && resignationDate > maxDate) v.add("resignationDate", "Resignation date cannot be after ${Dates.dmy(maxDate)}")
    }
    if (lastWorkingDate.isBlank()) v.add("lastWorkingDate", "Last working date is required")
    else if (!Dates.isValidIso(lastWorkingDate)) v.add("lastWorkingDate", "Last working date is not a valid date")
    else if (Dates.isValidIso(resignationDate) && lastWorkingDate < resignationDate) {
      v.add("lastWorkingDate", "Last working date cannot be before the resignation date")
    }
    v.text("reason", reason, "Reason", required = true, min = 5, max = 1000)
    return v.fields
  }

  // ---------------------------------------------------------------- support
  const val SUPPORT_DESC_MAX = 2000
  fun supportTicket(issueType: String, detailRequired: Boolean, issueDetail: String, subject: String, description: String): Map<String, String> {
    val v = V()
    if (issueType.isBlank()) v.add("issueType", "Please select an issue type")
    if (detailRequired && issueDetail.isBlank()) v.add("issueDetail", "Please select an issue detail")
    v.text("subject", subject, "Subject", required = true, min = 3, max = 120)
    v.text("description", description, "Description", required = true, min = 10, max = SUPPORT_DESC_MAX)
    return v.fields
  }

  fun supportReply(body: String, label: String = "Reply", key: String = "body"): Map<String, String> =
    V().apply { text(key, body, label, required = true, min = 2, max = 2000) }.fields

  // ---------------------------------------------------------------- tasks
  fun task(assignedTo: Long?, title: String, description: String, dueDate: String, dueTime: String, today: String): Map<String, String> {
    val v = V()
    if (assignedTo == null) v.add("assignedTo", "Assign to is required")
    v.text("title", title, "Title", required = true, min = 3, max = 150)
    v.text("description", description, "Description", max = 2000)
    if (dueDate.isBlank()) v.add("dueDate", "Due date is required")
    else if (dueDate < today) v.add("dueDate", "Due date cannot be in the past")
    if (dueTime.isNotBlank() && !TIME.matches(dueTime.trim())) v.add("aroundTime", "Due time must be a valid time like 17:30")
    return v.fields
  }

  // ---------------------------------------------------------------- change requests
  /** Only the fields that differ from the record (E59/E60). */
  fun changedFields(form: Map<String, String>, base: Map<String, String?>): Map<String, String> =
    form.filter { (k, v) -> k != "type" && v.trim().isNotEmpty() && v.trim() != (base[k] ?: "").trim() }
      .mapValues { it.value.trim() }

  const val NOTHING_CHANGED = "Nothing has changed — edit at least one field before sending."

  fun changeRequest(kind: String, payload: Map<String, String>, today: String): Map<String, String> {
    val v = V()
    if (payload.keys.none { it != "type" }) { v.add("_form", NOTHING_CHANGED); return v.fields }
    fun placeOk(s: String) = PLACE.matches(s.trim()) && s.trim().length <= 80
    when (kind) {
      "PROFILE" -> {
        payload["phone"]?.let { if (!MOBILE.matches(normaliseMobile(it))) v.add("phone", "Phone must be a valid 10-digit mobile number starting with 6-9") }
        payload["personalEmail"]?.let { if (!EMAIL.matches(it.trim())) v.add("personalEmail", "Personal email is not a valid email address") }
        payload["dob"]?.let {
          when {
            !Dates.isValidIso(it) -> v.add("dob", "Date of birth is not a valid date")
            it > Dates.addYears(today, -18) -> v.add("dob", "Date of birth must be in the past and you must be at least 18")
            it < Dates.addYears(today, -80) -> v.add("dob", "Date of birth cannot be before ${Dates.addYears(today, -80)}")
          }
        }
        payload["gender"]?.let { if (it.uppercase() !in setOf("MALE", "FEMALE", "OTHER")) v.add("gender", "Gender must be one of: MALE, FEMALE, OTHER") }
      }
      "ADDRESS" -> {
        payload["line1"]?.let { v.text("line1", it, "Address line 1", min = 3, max = 200) }
        payload["line2"]?.let { v.text("line2", it, "Address line 2", max = 200) }
        payload["city"]?.let { if (!placeOk(it)) v.add("city", "City should contain letters only") }
        payload["district"]?.let { if (!placeOk(it)) v.add("district", "District should contain letters only") }
        payload["state"]?.let { s -> if (INDIAN_STATES.none { it.equals(s.trim(), true) }) v.add("state", "Choose a state from the list") }
        payload["pincode"]?.let { if (!PIN.matches(it.trim())) v.add("pincode", "PIN code is not valid (6 digits)") }
        payload["country"]?.let { if (!placeOk(it)) v.add("country", "Country should contain letters only") }
      }
      "BANK" -> {
        payload["accountHolder"]?.let { if (!NAME.matches(it.trim()) || it.trim().length > 80) v.add("accountHolder", "Account holder should contain letters only") }
        payload["accountNumber"]?.let { if (!Regex("^\\d{9,18}$").matches(it.trim())) v.add("accountNumber", "Account number must be 9–18 digits") }
        payload["ifsc"]?.let { if (!IFSC.matches(it.trim().uppercase())) v.add("ifsc", "IFSC is not valid (like SBIN0001234)") }
        payload["branch"]?.let { if (!placeOk(it)) v.add("branch", "Branch should contain letters only") }
      }
    }
    return v.fields
  }

  // ---------------------------------------------------------------- address book
  /** E56: trimmed, case-insensitive; matches name, code, department or designation. */
  fun directoryMatches(query: String, vararg haystack: String?): Boolean {
    val q = query.trim().lowercase()
    if (q.isEmpty()) return true
    val terms = q.split(',').map { it.trim() }.filter { it.isNotEmpty() }
    val hay = haystack.filterNotNull().joinToString(" ").lowercase()
    return terms.all { hay.contains(it) }
  }
}
