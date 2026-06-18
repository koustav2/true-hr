package com.truehr.app.presentation.navigation

object Routes {
  const val SPLASH = "splash"
  const val LOGIN = "login"
  const val CHANGE_PASSWORD = "change_password"
  const val DASHBOARD = "dashboard"
  const val PROFILE = "profile"
  const val PF = "pf"
  const val ATTENDANCE = "attendance"
  const val MARK_ATTENDANCE = "mark_attendance"
  const val DAILY_ATTENDANCE = "daily_attendance"
  const val MONTHLY_ATTENDANCE = "monthly_attendance"
  // per-member views (opened from Team Attendance)
  const val MEMBER_DAILY = "member_daily?eid={eid}&name={name}"
  fun memberDaily(eid: Long, name: String) =
    "member_daily?eid=$eid&name=${java.net.URLEncoder.encode(name, "UTF-8")}"
  const val MEMBER_MONTHLY = "member_monthly?eid={eid}&name={name}"
  fun memberMonthly(eid: Long, name: String) =
    "member_monthly?eid=$eid&name=${java.net.URLEncoder.encode(name, "UTF-8")}"
  const val TEAM_ATTENDANCE = "team_attendance"
  const val HOLD_TEAM_ATTENDANCE = "hold_team_attendance"
  const val APPLY_MISS_PUNCH = "apply_miss_punch"
  const val VIEW_MISS_PUNCH = "view_miss_punch"
  const val TEAM_MISS_PUNCH = "team_miss_punch"
  const val APPLY_OD = "apply_od"
  const val VIEW_OD = "view_od"
  const val TEAM_OD = "team_od"
  const val LEAVE = "leave"
  const val APPLY_LEAVE = "apply_leave"
  const val VIEW_LEAVE = "view_leave"
  const val TEAM_LEAVE = "team_leave"
  const val SALARY = "salary"
  const val TEAM = "team"
  const val ADDRESS_BOOK = "address_book"
  const val POLICIES = "policies"
  const val SUPPORT = "support"
  const val TOUR = "tour"
  const val ESS = "ess"

  // generic feature route: feature/{title}
  const val FEATURE = "feature/{title}"
  fun feature(title: String) = "feature/$title"
}
