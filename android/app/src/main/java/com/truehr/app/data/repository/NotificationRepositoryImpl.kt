package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.NotificationDto
import com.truehr.app.domain.repository.NotificationRepository
import javax.inject.Inject

class NotificationRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : NotificationRepository {
  override suspend fun list(): List<NotificationDto> = api.notifications()
  override suspend fun unreadCount(): Int = api.notificationUnreadCount().count
  override suspend fun markAllRead() = api.markNotificationsRead()
}
