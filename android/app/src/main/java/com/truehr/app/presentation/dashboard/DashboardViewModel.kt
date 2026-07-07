package com.truehr.app.presentation.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.BannerDto
import com.truehr.app.domain.repository.AuthRepository
import com.truehr.app.domain.repository.ProfileRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HeaderState(val name: String = "Employee", val designation: String = "", val isManager: Boolean = false)

@HiltViewModel
class DashboardViewModel @Inject constructor(
  private val profileRepository: ProfileRepository,
  private val authRepository: AuthRepository,
  // Single read-only call — not worth a repository of its own.
  private val api: ApiService,
) : ViewModel() {
  val header = MutableStateFlow(HeaderState())
  val banners = MutableStateFlow<List<BannerDto>>(emptyList())

  init { load() }

  private fun load() = viewModelScope.launch {
    try {
      val p = profileRepository.getProfile()
      header.update { HeaderState(p.fullName, p.designation, p.isManager) }
    } catch (_: Exception) { /* keep defaults */ }
    try { banners.value = api.banners() } catch (_: Exception) { /* no carousel */ }
  }

  fun logout(onDone: () -> Unit) = viewModelScope.launch { authRepository.logout(); onDone() }
}
