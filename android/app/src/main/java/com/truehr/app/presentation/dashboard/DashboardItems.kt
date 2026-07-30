package com.truehr.app.presentation.dashboard

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import com.truehr.app.core.FeatureFlags
import com.truehr.app.presentation.navigation.Routes
import com.truehr.app.presentation.theme.*

data class DashItem(val label: String, val icon: ImageVector, val route: String, val tint: Color = Green)

val dashboardItems = listOfNotNull(
  DashItem("Attendance", Icons.Filled.EventAvailable, Routes.ATTENDANCE, Green),
  DashItem("Task Summary", Icons.AutoMirrored.Filled.ListAlt, Routes.TASK_SUMMARY, Amber),
  DashItem("Salary Slip", Icons.Filled.ReceiptLong, Routes.SALARY, Teal),
  DashItem("Tour Management", Icons.Filled.Map, Routes.TOUR, Sky),
  DashItem("Support Desk", Icons.Filled.SupportAgent, Routes.SUPPORT, Amber),
  DashItem("Leave Management", Icons.Filled.BeachAccess, Routes.LEAVE, Rose),
  DashItem("Address Book", Icons.Filled.Place, Routes.ADDRESS_BOOK, Sky),
  // My ESS opens the web employee portal (SSO) — NFA & co. live there.
  if (FeatureFlags.MY_ESS) DashItem("My ESS", Icons.Filled.Spa, Routes.ESS, Teal) else null,
  DashItem("Team List", Icons.Filled.Groups, Routes.TEAM, Violet),
  DashItem("PF, ESIC & Insurance", Icons.Filled.HealthAndSafety, Routes.PF, Teal),
  DashItem("Policies", Icons.AutoMirrored.Filled.MenuBook, Routes.POLICIES, Grape),
  DashItem("Resignation", Icons.AutoMirrored.Filled.ExitToApp, Routes.RESIGNATION, Rose),
)

/** Everything not on the dashboard grid lives here — the top-right three-dot menu. */
val settingsMenuItems = listOfNotNull(
  DashItem("My Profile", Icons.Filled.Person, Routes.PROFILE, Violet),
  // NFA / PMS suite — hidden behind FeatureFlags.NFA_SUITE for this release.
  if (FeatureFlags.NFA_SUITE) DashItem("NFA", Icons.Filled.RequestQuote, Routes.NFA, Grape) else null,
  if (FeatureFlags.NFA_SUITE) DashItem("My Performance", Icons.Filled.Insights, Routes.MY_PERFORMANCE, Sky) else null,
  if (FeatureFlags.NFA_SUITE) DashItem("Team KPI & PMS", Icons.Filled.Grade, Routes.TEAM_PMS, Amber) else null,
  DashItem("Team Tasks", Icons.Filled.AddTask, Routes.TEAM_TASK, Green),
  DashItem("Team Resignation", Icons.Filled.HowToReg, Routes.TEAM_RESIGNATION, Violet),
  DashItem("Change Password", Icons.Filled.Lock, Routes.CHANGE_PASSWORD, Green),
)
