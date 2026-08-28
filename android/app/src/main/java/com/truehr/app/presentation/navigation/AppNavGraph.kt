package com.truehr.app.presentation.navigation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NamedNavArgument
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.navigation.NavType
import com.truehr.app.presentation.theme.Canvas
import com.truehr.app.presentation.auth.ChangePasswordScreen
import com.truehr.app.presentation.auth.ForgotPasswordScreen
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
import com.truehr.app.presentation.feature.PoliciesScreen
import com.truehr.app.presentation.feature.TeamListScreen
import com.truehr.app.presentation.feature.TeamAttendanceScreen
import com.truehr.app.presentation.feature.SalarySlipScreen
import com.truehr.app.presentation.feature.PayslipDetailScreen
import com.truehr.app.presentation.feature.TaskSummaryScreen
import com.truehr.app.presentation.feature.AssignTaskScreen
import com.truehr.app.presentation.feature.TeamTaskScreen
import com.truehr.app.presentation.feature.ResignationScreen
import com.truehr.app.presentation.feature.TeamResignationScreen
import com.truehr.app.presentation.feature.EssScreen
import com.truehr.app.presentation.feature.EssWebScreen
import com.truehr.app.presentation.feature.NfaMenuScreen
import com.truehr.app.presentation.feature.CreateNfaScreen
import com.truehr.app.presentation.feature.NfaListScreen
import com.truehr.app.presentation.feature.NfaDetailScreen
import com.truehr.app.presentation.feature.SettlementApprovalsScreen
import com.truehr.app.presentation.feature.MyPerformanceScreen
import com.truehr.app.presentation.feature.CreateKpiScreen
import com.truehr.app.presentation.feature.KpiDetailScreen
import com.truehr.app.presentation.feature.TeamPmsScreen
import com.truehr.app.presentation.feature.VendorRegistrationScreen
import com.truehr.app.presentation.feature.UploadAgreementScreen
import com.truehr.app.presentation.feature.TourScreen
import com.truehr.app.presentation.feature.LiveTourScreen
import com.truehr.app.presentation.feature.TourDetailsScreen
import com.truehr.app.presentation.feature.TourRouteScreen
import com.truehr.app.presentation.feature.GeoTagScreen
import com.truehr.app.presentation.feature.GeoTagListScreen
import com.truehr.app.presentation.profile.PfScreen
import com.truehr.app.presentation.profile.ProfileScreen
import com.truehr.app.presentation.splash.SplashScreen
import com.truehr.app.presentation.feature.NotificationsScreen
import com.truehr.app.push.PendingPushRoute
import com.truehr.app.push.PushRoutes
import kotlinx.coroutines.flow.filterNotNull

/**
 * Post-login route: keeps content above the system navigation bar while the
 * canvas colour still paints behind the transparent bar (edge-to-edge).
 * Splash/Login stay on plain [composable] — they draw full-bleed and pad themselves.
 */
private fun NavGraphBuilder.screen(
  route: String,
  arguments: List<NamedNavArgument> = emptyList(),
  content: @Composable (NavBackStackEntry) -> Unit,
) {
  composable(route, arguments) { entry ->
    Box(Modifier.fillMaxSize().background(Canvas).navigationBarsPadding()) { content(entry) }
  }
}

@Composable
fun AppNavGraph(nav: NavHostController = rememberNavController(), rootVm: RootViewModel = hiltViewModel()) {

  fun toDashboard() = nav.navigate(Routes.DASHBOARD) {
    popUpTo(Routes.SPLASH) { inclusive = true }
    popUpTo(Routes.LOGIN) { inclusive = true }
    launchSingleTop = true
  }
  fun toLogin() = nav.navigate(Routes.LOGIN) {
    popUpTo(0) { inclusive = true }
    launchSingleTop = true
  }

  // Server rejected our token (401) anywhere in the app → bounce to the login screen.
  LaunchedEffect(Unit) {
    rootVm.logoutEvents.collect { toLogin() }
  }

  // Tapped push notification → open its screen once the user is inside the app.
  val authRoutes = setOf(Routes.SPLASH, Routes.LOGIN, Routes.FORGOT_PASSWORD, Routes.CHANGE_PASSWORD)
  fun consumePushRoute() {
    val cur = nav.currentBackStackEntry?.destination?.route ?: return
    if (cur in authRoutes) return // not signed in yet — keep it pending
    PendingPushRoute.consume()?.let { key -> nav.navigate(PushRoutes.toNavRoute(key)) }
  }
  // Cold start: the route waits until splash/login lands on the dashboard.
  LaunchedEffect(Unit) {
    nav.currentBackStackEntryFlow.collect { consumePushRoute() }
  }
  // Warm start (app already open, notification tapped) → navigate immediately.
  LaunchedEffect(Unit) {
    PendingPushRoute.flow.filterNotNull().collect { consumePushRoute() }
  }

  NavHost(navController = nav, startDestination = Routes.SPLASH) {
    composable(Routes.SPLASH) {
      SplashScreen(onLoggedIn = { toDashboard() }, onGuest = { nav.navigate(Routes.LOGIN) { popUpTo(Routes.SPLASH) { inclusive = true } } })
    }
    composable(Routes.LOGIN) {
      LoginScreen(onLoggedIn = { toDashboard() }, onMustChange = { nav.navigate(Routes.CHANGE_PASSWORD) },
        onForgotPassword = { nav.navigate(Routes.FORGOT_PASSWORD) })
    }
    screen(Routes.FORGOT_PASSWORD) {
      ForgotPasswordScreen(onBack = { nav.popBackStack() })
    }
    screen(Routes.CHANGE_PASSWORD) {
      ChangePasswordScreen(onDone = { nav.popBackStack() }, onBack = { nav.popBackStack() })
    }
    screen(Routes.DASHBOARD) {
      DashboardScreen(onOpen = { route -> nav.navigate(route) }, onLoggedOut = { toLogin() })
    }
    screen(Routes.NOTIFICATIONS) {
      NotificationsScreen(onBack = { nav.popBackStack() }, onOpen = { nav.navigate(it) })
    }
    screen(Routes.PROFILE) { ProfileScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.PF) { PfScreen(onBack = { nav.popBackStack() }) }

    screen(Routes.ATTENDANCE) { AttendanceMenuScreen(onOpen = { nav.navigate(it) }, onBack = { nav.popBackStack() }) }
    screen(Routes.MARK_ATTENDANCE) { MarkAttendanceScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.DAILY_ATTENDANCE) { DailyAttendanceScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.MONTHLY_ATTENDANCE) { MonthlyAttendanceScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.TEAM_ATTENDANCE) {
      TeamAttendanceScreen(
        onBack = { nav.popBackStack() },
        onOpenDaily = { m -> nav.navigate(Routes.memberDaily(m.employeeId, m.name)) },
        onOpenMonthly = { m -> nav.navigate(Routes.memberMonthly(m.employeeId, m.name)) },
      )
    }
    screen(
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
    screen(
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
    screen(Routes.HOLD_TEAM_ATTENDANCE) { HoldTeamScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.APPLY_MISS_PUNCH) { ApplyMissPunchScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.VIEW_MISS_PUNCH) { MissPunchListScreen("View Miss Punch", teamView = false, onBack = { nav.popBackStack() }) }
    screen(Routes.TEAM_MISS_PUNCH) { MissPunchListScreen("Team Miss Punch", teamView = true, onBack = { nav.popBackStack() }) }

    screen(Routes.APPLY_OD) { ApplyOdScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.VIEW_OD) { OdListScreen("View OD", teamView = false, onBack = { nav.popBackStack() }) }
    screen(Routes.TEAM_OD) { OdListScreen("Team OD", teamView = true, onBack = { nav.popBackStack() }) }

    screen(Routes.LEAVE) { LeaveMenuScreen(onOpen = { nav.navigate(it) }, onBack = { nav.popBackStack() }) }
    screen(Routes.APPLY_LEAVE) { ApplyLeaveScreen(onBack = { nav.popBackStack() }, onAvailCompOff = { nav.navigate(Routes.AVAIL_COMPOFF) }) }
    screen(Routes.VIEW_LEAVE) { LeaveListScreen("View Leave", teamView = false, onBack = { nav.popBackStack() }) }
    screen(Routes.TEAM_LEAVE) { LeaveListScreen("Team Leave", teamView = true, onBack = { nav.popBackStack() }) }
    screen(Routes.AVAIL_COMPOFF) { CompOffScreen("Avail CompOff", teamView = false, onBack = { nav.popBackStack() }) }
    screen(Routes.TEAM_COMPOFF) { CompOffScreen("Team CompOff", teamView = true, onBack = { nav.popBackStack() }) }
    screen(Routes.SALARY) { SalarySlipScreen(onBack = { nav.popBackStack() }, onOpenDetail = { id -> nav.navigate(Routes.salaryDetail(id)) }) }
    screen(
      route = Routes.SALARY_DETAIL,
      arguments = listOf(navArgument("id") { type = NavType.LongType }),
    ) { e -> PayslipDetailScreen(payslipId = e.arguments?.getLong("id") ?: 0L, onBack = { nav.popBackStack() }) }
    screen(Routes.TEAM) { TeamListScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.ADDRESS_BOOK) { AddressBookScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.POLICIES) { PoliciesScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.SUPPORT) { SupportDeskScreen(onOpen = { nav.navigate(it) }, onBack = { nav.popBackStack() }) }
    screen(
      route = Routes.SUPPORT_CREATE,
      arguments = listOf(navArgument("cat") { type = NavType.StringType }),
    ) { e -> CreateTicketScreen(category = e.arguments?.getString("cat") ?: "HR", onBack = { nav.popBackStack() }) }
    screen(
      route = Routes.SUPPORT_VIEW,
      arguments = listOf(navArgument("cat") { type = NavType.StringType }),
    ) { e -> ViewTicketsScreen(category = e.arguments?.getString("cat") ?: "HR", onBack = { nav.popBackStack() }) }
    screen(Routes.TOUR) { TourScreen(onOpen = { nav.navigate(it) }, onBack = { nav.popBackStack() }) }
    screen(Routes.TOUR_LIVE) { LiveTourScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.TOUR_DETAILS) { TourDetailsScreen(onBack = { nav.popBackStack() }, onOpenRoute = { id -> nav.navigate(Routes.tourRoute(id)) }) }
    screen(
      route = Routes.TOUR_ROUTE,
      arguments = listOf(navArgument("id") { type = NavType.LongType }),
    ) { e -> TourRouteScreen(tourId = e.arguments?.getLong("id") ?: 0L, onBack = { nav.popBackStack() }) }
    screen(Routes.GEOTAG) { GeoTagScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.GEOTAG_LIST) { GeoTagListScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.TASK_SUMMARY) { TaskSummaryScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.ASSIGN_TASK) { AssignTaskScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.TEAM_TASK) { TeamTaskScreen(onAssign = { nav.navigate(Routes.ASSIGN_TASK) }, onBack = { nav.popBackStack() }) }
    screen(Routes.RESIGNATION) { ResignationScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.TEAM_RESIGNATION) { TeamResignationScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.ESS) {
      // My ESS lives on the web (NFA, settlements, PMS, vendors). The tile
      // fetches a 60s SSO token and opens the browser already signed in.
      EssWebScreen(onBack = { nav.popBackStack() })
    }
    screen(
      route = Routes.ESS_WEB,
      arguments = listOf(navArgument("section") { type = NavType.StringType; defaultValue = "" }),
    ) { entry ->
      EssWebScreen(section = entry.arguments?.getString("section") ?: "", onBack = { nav.popBackStack() })
    }
    screen(Routes.SETTLEMENT_APPROVALS) { SettlementApprovalsScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.MY_PERFORMANCE) {
      MyPerformanceScreen(onBack = { nav.popBackStack() },
        onCreateKpi = { nav.navigate(Routes.CREATE_KPI) },
        onOpenKpi = { id -> nav.navigate(Routes.kpiDetail(id)) })
    }
    screen(Routes.CREATE_KPI) { CreateKpiScreen(onBack = { nav.popBackStack() }) }
    screen(
      route = Routes.KPI_DETAIL,
      arguments = listOf(navArgument("id") { type = NavType.LongType }),
    ) { e -> KpiDetailScreen(kpiId = e.arguments?.getLong("id") ?: 0L, onBack = { nav.popBackStack() }) }
    screen(Routes.TEAM_PMS) { TeamPmsScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.VENDOR_REGISTRATION) { VendorRegistrationScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.UPLOAD_AGREEMENT) { UploadAgreementScreen(onBack = { nav.popBackStack() }) }

    screen(Routes.NFA) { NfaMenuScreen(onOpen = { nav.navigate(it) }, onBack = { nav.popBackStack() }) }
    screen(Routes.NFA_CREATE) { CreateNfaScreen(onBack = { nav.popBackStack() }) }
    screen(Routes.NFA_LIST) {
      NfaListScreen("My NFAs", inbox = false, onBack = { nav.popBackStack() },
        onOpen = { id, act -> nav.navigate(Routes.nfaDetail(id, act)) })
    }
    screen(Routes.NFA_APPROVALS) {
      NfaListScreen("NFA Approvals", inbox = true, onBack = { nav.popBackStack() },
        onOpen = { id, act -> nav.navigate(Routes.nfaDetail(id, act)) })
    }
    screen(
      route = Routes.NFA_DETAIL,
      arguments = listOf(
        navArgument("id") { type = NavType.LongType },
        navArgument("act") { type = NavType.BoolType; defaultValue = false },
      ),
    ) { e ->
      NfaDetailScreen(
        id = e.arguments?.getLong("id") ?: 0L,
        canAct = e.arguments?.getBoolean("act") ?: false,
        onBack = { nav.popBackStack() },
      )
    }

    screen(
      route = Routes.FEATURE,
      arguments = listOf(navArgument("title") { type = NavType.StringType }),
    ) { entry ->
      FeatureScreen(entry.arguments?.getString("title") ?: "Feature", onBack = { nav.popBackStack() })
    }
  }
}
