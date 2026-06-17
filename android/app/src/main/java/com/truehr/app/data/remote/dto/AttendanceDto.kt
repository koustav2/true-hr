package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class PunchRequest(
  val type: String,
  val lat: Double? = null,
  val lng: Double? = null,
  val address: String? = null,
  val photo: String? = null,
  val capturedAt: String? = null,
)

@Serializable
data class PunchResponse(
  val ok: Boolean = false,
  val id: Long? = null,
  val type: String? = null,
  val capturedAt: String? = null,
  val address: String? = null,
)

@Serializable
data class TodayDto(
  val punchedIn: Boolean = false,
  val hasIn: Boolean = false,
  val hasOut: Boolean = false,
  val completed: Boolean = false,
)

@Serializable
data class AttendanceRecordDto(
  val id: Long,
  val type: String,
  val captured_at: String,
  val lat: Double? = null,
  val lng: Double? = null,
  val address: String? = null,
  val has_photo: Boolean = false,
)
