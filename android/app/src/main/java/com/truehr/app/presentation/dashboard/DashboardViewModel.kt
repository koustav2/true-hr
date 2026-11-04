package com.truehr.app.presentation.dashboard

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.apiMessage
import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.BannerDto
import com.truehr.app.domain.repository.AuthRepository
import com.truehr.app.domain.repository.NotificationRepository
import com.truehr.app.domain.repository.ProfileRepository
import com.truehr.app.push.PushTokenManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HeaderState(
  val name: String = "",
  val designation: String = "",
  val isManager: Boolean = false,
  val employeeCode: String = "",
  /** E2: true only when /me/team returns at least one active reportee. */
  val hasTeam: Boolean = false,
  /** Why the header could not load (shown as a small retry line), or null. */
  val error: String? = null,
)

@HiltViewModel
class DashboardViewModel @Inject constructor(
  private val profileRepository: ProfileRepository,
  private val authRepository: AuthRepository,
  private val notificationRepository: NotificationRepository,
  private val pushTokenManager: PushTokenManager,
  // Single read-only call — not worth a repository of its own.
  private val api: ApiService,
) : ViewModel() {
  val header = MutableStateFlow(HeaderState())
  val banners = MutableStateFlow<List<BannerDto>>(emptyList())
  val unread = MutableStateFlow(0)
  val signingOut = MutableStateFlow(false)

  init {
    load()
    // Covers users who were already signed in before push support shipped —
    // login-time registration only reaches fresh sign-ins.
    viewModelScope.launch { if (!pushTokenManager.register()) Log.i(TAG, "Push registration skipped or failed") }
  }

  fun refreshUnread() = viewModelScope.launch {
    try { unread.value = notificationRepository.unreadCount() }
    catch (e: Exception) { Log.w(TAG, "Unread count failed; keeping the last value", e) }
  }

  fun load() = viewModelScope.launch {
    header.update { it.copy(error = null) }
    try {
      val p = profileRepository.getProfile()
      header.update { it.copy(name = p.fullName, designation = p.designation, isManager = p.isManager, employeeCode = p.employeeCode) }
    } catch (e: Exception) {
      Log.w(TAG, "Profile failed", e)
      // E63: fall back to the account's name from /me, never the email.
      val name = runCatching { api.me().let { m -> m.name ?: listOfNotNull(m.first_name, m.last_name).joinToString(" ") } }.getOrNull()
      header.update { it.copy(name = name.orEmpty(), error = e.apiMessage("Couldn't load your profile")) }
    }
    try { header.update { it.copy(hasTeam = profileRepository.myTeam().isNotEmpty()) } }
    catch (e: Exception) { Log.w(TAG, "Team check failed; showing the no-team layout", e) }
    try { banners.value = api.banners() }
    catch (e: Exception) { Log.w(TAG, "Banners failed; carousel hidden", e) }
  }

  fun logout(onDone: () -> Unit) = viewModelScope.launch {
    signingOut.value = true
    authRepository.logout()
    signingOut.value = false
    onDone()
  }

  private companion object { const val TAG = "Dashboard" }
}
