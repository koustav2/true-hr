package com.truehr.app.push

import com.truehr.app.presentation.navigation.Routes

/**
 * Maps the `route` key carried in a push message / notification row to an
 * in-app navigation route. Backend keys deliberately match Routes constants;
 * anything unknown lands on the notification centre.
 */
object PushRoutes {
  private val allowed = setOf(
    Routes.ATTENDANCE, Routes.DAILY_ATTENDANCE, Routes.MONTHLY_ATTENDANCE,
    Routes.VIEW_LEAVE, Routes.TEAM_LEAVE, Routes.APPLY_LEAVE,
    Routes.VIEW_MISS_PUNCH, Routes.TEAM_MISS_PUNCH, Routes.APPLY_MISS_PUNCH,
    Routes.VIEW_OD, Routes.TEAM_OD,
    Routes.RESIGNATION, Routes.TEAM_RESIGNATION,
    Routes.SUPPORT, Routes.SALARY, Routes.TEAM,
    Routes.NOTIFICATIONS,
  )

  fun toNavRoute(key: String?): String =
    if (key != null && key in allowed) key else Routes.NOTIFICATIONS
}

/**
 * Holds the deep-link route of a tapped notification until the nav graph is
 * ready to navigate (app may be cold-starting through splash/login).
 */
object PendingPushRoute {
  private val _flow = kotlinx.coroutines.flow.MutableStateFlow<String?>(null)
  val flow: kotlinx.coroutines.flow.StateFlow<String?> = _flow

  fun set(route: String) { _flow.value = route }
  fun consume(): String? = _flow.value.also { _flow.value = null }
}
