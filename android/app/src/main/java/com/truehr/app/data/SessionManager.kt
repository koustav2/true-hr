package com.truehr.app.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/** App-wide channel for forced sign-outs (e.g. an expired/invalid token returns 401). */
@Singleton
class SessionManager @Inject constructor() {
  private val _logoutEvents = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
  val logoutEvents: SharedFlow<Unit> = _logoutEvents

  fun forceLogout() { _logoutEvents.tryEmit(Unit) }
}
