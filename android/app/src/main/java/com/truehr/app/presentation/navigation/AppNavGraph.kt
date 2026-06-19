package com.truehr.app.presentation.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.NavType
import com.truehr.app.presentation.auth.ChangePasswordScreen
import com.truehr.app.presentation.auth.LoginScreen
import com.truehr.app.presentation.dashboard.DashboardScreen
import com.truehr.app.presentation.feature.ApplyMissPunchScreen
import com.truehr.app.presentation.feature.AttendanceMenuScreen
import com.truehr.app.presentation.feature.DailyAttendanceScreen
import com.truehr.app.presentation.feature.FeatureScreen
import com.truehr.app.presentation.feature.HoldTeamScreen
import com.truehr.app.presentation.feature.ApplyOdScreen
import com.truehr.app.presentation.feature.MarkAttendanceScreen
import com.truehr.app.presentation.feature.MissPunchListScreen
import com.truehr.app.presentation.feature.MonthlyAttendanceScreen
import com.truehr.app.presentation.feature.AddressBookScreen
import com.truehr.app.presentation.feature.ApplyLeaveScreen
import com.truehr.app.presentation.feature.CompOffScreen
import com.truehr.app.presentation.feature.CreateTicketScreen
import com.truehr.app.presentation.feature.SupportDeskScreen
import com.truehr.app.presentation.feature.ViewTicketsScreen
import com.truehr.app.presentation.feature.LeaveListScreen
import com.truehr.app.presentation.feature.LeaveMenuScreen
import com.truehr.app.presentation.feature.OdListScreen
import com.truehr.app.presentation.feature.TeamListScreen
import com.truehr.app.presentation.feature.TeamAttendanceScreen
import com.truehr.app.presentation.profile.PfScreen
import com.truehr.app.presentation.profile.ProfileScreen
import com.truehr.app.presentation.splash.SplashScreen

@Composable
fun AppNavGraph(nav: NavHostController = rememberNavController()) {

  fun toDashboard() = nav.navigate(Routes.DASHBOARD) {
    popUpTo(Routes.SPLASH) { inclusive = true }
    popUpTo(Routes.LOGIN) { inclusive = true }
    launchSingleTop = true
  }
  fun toLogin() = nav.navigate(Routes.LOGIN) {
    popUpTo(0) { inclusive = true }
  }

  NavHost(navController = nav, startDestination = Routes.SPLASH) {
    composable(Routes.SPLASH) {
      SplashScreen(onLoggedIn = { toDashboard() }, onGuest = { nav.navigate(Routes.LOGIN) { popUpTo(Routes.SPLASH) { inclusive = true } } })
    }
    composable(Routes.LOGIN) {
      LoginScreen(onLoggedIn = { toDashboard() }, onMustChange = { nav.navigate(Routes.CHANGE_PASSWORD) })
    }
    composable(Routes.CHANGE_PASSWORD) {
      ChangePasswordScreen(onDone = { nav.popBackStack() }, onBack = { nav.popBackStack() })
    }
    composable(Routes.DASHBOARD) {
      DashboardScreen(onOpen = { route -> nav.navigate(route) }, onLoggedOut = { toLogin() })
    }
    composable(Routes.PROFILE) { ProfileScreen(onBack = { nav.popBackStack() }) }
    composable(Routes.PF) { PfScreen(onBack = { nav.popBackStack() }) }

    composable(Routes.ATTENDANCE) { AttendanceMenuScreen(onOpen = { nav.navigate(it) }, onBack = { nav.popBackStack() }) }
    composable(Routes.MARK_ATTENDANCE) { MarkAttendanceScreen(onBack = { nav.popBackStack() }) }
    composable(Routes.DAILY_ATTENDANCE) { DailyAttendanceScreen(onBack = { nav.popBackStack() }) }
    composable(Routes.MONTHLY_ATTENDANCE) { MonthlyAttendanceScreen(onBack = { nav.popBackStack() }) }
    composable(Routes.TEAM_ATTENDANCE) {
      TeamAttendanceScreen(
        onBack = { nav.popBackStack() },
        onOpenDaily = { m -> nav.navigate(Routes.memberDaily(m.employeeId, m.name)) },
        onOpenMonthly = { m -> nav.navigate(Routes.memberMonthly(m.employeeId, m.name)) },
      )
    }
    composable(
      route = Routes.MEMBER_DAILY,
      arguments = listOf(
        navArgument("eid") { type = NavType.LongType; defaultValue = 0L },
        navArgument("name") { type = NavType.StringType; defaultValue = "" },
      ),
    ) { entry ->
      val eid = entry.arguments?.getLong("eid") ?: 0L
      val name = entry.arguments?.getString("name").orEmpty()
      DailyAttendanceScreen(onBack = { nav.popBackStack() }, employeeId = eid.takeIf { it > 0 }, name = name)
    }
    composable(
      route = Routes.MEMBER_MONTHLY,
      arguments = listOf(
        navArgument("eid") { type = NavType.LongType; defaultValue = 0L },
        navArgument("name") { type = NavType.StringType; defaultValue = "" },
      ),
    ) { entry ->
      val eid = entry.arguments?.getLong("eid") ?: 0L
      val name = entry.arguments?.getString("name").orEmpty()
      MonthlyAttendanceScreen(onBack = { nav.popBackStack() }, employeeId = eid.takeIf { it > 0 }, name = name)
    }
    composable(Routes.HOLD_TEAM_ATTENDANCE) { HoldTeamScreen(onBack = { nav.popBackStack() }) }
    composable(Routes.APPLY_MISS_PUNCH) { ApplyMissPunchScreen(onBack = { nav.popBackStack() }) }
    composable(Routes.VIEW_MISS_PUNCH) { MissPunchListScreen("View Miss Punch", teamView = false, onBack = { nav.popBackStack() }) }
    composable(Routes.TEAM_MISS_PUNCH) { MissPunchListScreen("Team Miss Punch", teamView = true, onBack = { nav.popBackStack() }) }

    composable(Routes.APPLY_OD) { ApplyOdScreen(onBack = { nav.popBackStack() }) }
    composable(Routes.VIEW_OD) { OdListScreen("View OD", teamView = false, onBack = { nav.popBackStack() }) }
    composable(Routes.TEAM_OD) { OdListScreen("Team OD", teamView = true, onBack = { nav.popBackStack() }) }

    composable(Routes.LEAVE) { LeaveMenuScreen(onOpen = { nav.navigate(it) }, onBack = { nav.popBackStack() }) }
    composable(Routes.APPLY_LEAVE) { ApplyLeaveScreen(onBack = { nav.popBackStack() }, onAvailCompOff = { nav.navigate(Routes.AVAIL_COMPOFF) }) }
    composable(Routes.VIEW_LEAVE) { LeaveListScreen("View Leave", teamView = false, onBack = { nav.popBackStack() }) }
    composable(Routes.TEAM_LEAVE) { LeaveListScreen("Team Leave", teamView = true, onBack = { nav.popBackStack() }) }
    composable(Routes.AVAIL_COMPOFF) { CompOffScreen("Avail CompOff", teamView = false, onBack = { nav.popBackStack() }) }
    composable(Routes.TEAM_COMPOFF) { CompOffScreen("Team CompOff", teamView = true, onBack = { nav.popBackStack() }) }
    composable(Routes.SALARY) { FeatureScreen("Salary Slip", onBack = { nav.popBackStack() }) }
    composable(Routes.TEAM) { TeamListScreen(onBack = { nav.popBackStack() }) }
    composable(Routes.ADDRESS_BOOK) { AddressBookScreen(onBack = { nav.popBackStack() }) }
    composable(Routes.POLICIES) { FeatureScreen("Policies", onBack = { nav.popBackStack() }) }
    composable(Routes.SUPPORT) { SupportDeskScreen(onOpen = { nav.navigate(it) }, onBack = { nav.popBackStack() }) }
    composable(
      route = Routes.SUPPORT_CREATE,
      arguments = listOf(navArgument("cat") { type = NavType.StringType }),
    ) { e -> CreateTicketScreen(category = e.arguments?.getString("cat") ?: "HR", onBack = { nav.popBackStack() }) }
    composable(
      route = Routes.SUPPORT_VIEW,
      arguments = listOf(navArgument("cat") { type = NavType.StringType }),
    ) { e -> ViewTicketsScreen(category = e.arguments?.getString("cat") ?: "HR", onBack = { nav.popBackStack() }) }
    composable(Routes.TOUR) { FeatureScreen("Tour Management", onBack = { nav.popBackStack() }) }
    composable(Routes.ESS) { FeatureScreen("My ESS", onBack = { nav.popBackStack() }) }

    composable(
      route = Routes.FEATURE,
      arguments = listOf(navArgument("title") { type = NavType.StringType }),
    ) { entry ->
      FeatureScreen(entry.arguments?.getString("title") ?: "Feature", onBack = { nav.popBackStack() })
    }
  }
}
