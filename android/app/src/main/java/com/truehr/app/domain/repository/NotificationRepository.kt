package com.truehr.app.domain.repository

import com.truehr.app.data.remote.dto.NotificationDto

interface NotificationRepository {
  suspend fun list(): List<NotificationDto>
  suspend fun unreadCount(): Int
  suspend fun markAllRead()
}
