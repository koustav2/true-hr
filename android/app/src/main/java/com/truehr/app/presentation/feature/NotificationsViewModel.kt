package com.truehr.app.presentation.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.data.remote.dto.NotificationDto
import com.truehr.app.domain.repository.NotificationRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class NotificationsViewModel @Inject constructor(
  private val repo: NotificationRepository,
) : ViewModel() {
  val list = MutableStateFlow(UiState<List<NotificationDto>>())

  fun load() = viewModelScope.launch {
    list.update { it.copy(loading = true, error = null) }
    try {
      val items = repo.list()
      list.value = UiState(data = items)
      // Opening the centre clears the bell badge.
      if (items.any { !it.read }) runCatching { repo.markAllRead() }
    } catch (e: Exception) {
      list.value = UiState(error = e.apiMessage("Failed to load notifications"))
    }
  }
}
