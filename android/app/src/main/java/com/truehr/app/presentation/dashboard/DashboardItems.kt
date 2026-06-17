package com.truehr.app.presentation.dashboard

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.graphics.vector.ImageVector
import com.truehr.app.presentation.navigation.Routes

data class DashItem(val label: String, val icon: ImageVector, val route: String)

val dashboardItems = listOf(
  DashItem("Attendance", Icons.Filled.EventAvailable, Routes.ATTENDANCE),
  DashItem("My Profile", Icons.Filled.Person, Routes.PROFILE),
  DashItem("Salary Slip", Icons.Filled.ReceiptLong, Routes.SALARY),
  DashItem("Tour Management", Icons.Filled.Map, Routes.TOUR),
  DashItem("Support Desk", Icons.Filled.SupportAgent, Routes.SUPPORT),
  DashItem("Leave Management", Icons.Filled.BeachAccess, Routes.LEAVE),
  DashItem("My ESS", Icons.Filled.Spa, Routes.ESS),
  DashItem("Address Book", Icons.Filled.Place, Routes.ADDRESS_BOOK),
  DashItem("Team List", Icons.Filled.Groups, Routes.TEAM),
  DashItem("PF, ESIC & Insurance", Icons.Filled.HealthAndSafety, Routes.PF),
  DashItem("Policies", Icons.AutoMirrored.Filled.ListAlt, Routes.POLICIES),
  DashItem("Change Password", Icons.Filled.Lock, Routes.CHANGE_PASSWORD),
)
