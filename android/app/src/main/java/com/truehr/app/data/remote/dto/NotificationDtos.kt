package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class DeviceTokenRequest(val token: String, val platform: String = "android")

@Serializable
data class NotificationDto(
  val id: Long,
  val type: String? = null,
  val title: String? = null,
  val body: String? = null,
  val route: String? = null,
  val read: Boolean = false,
  val createdAt: String? = null,
)

@Serializable
data class UnreadCountDto(val count: Int = 0)
