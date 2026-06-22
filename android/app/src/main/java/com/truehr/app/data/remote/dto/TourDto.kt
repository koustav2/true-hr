package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class TourDto(
  val id: Long,
  val clientUuid: String? = null,
  val status: String? = null,
  val startedAt: String? = null,
  val endedAt: String? = null,
  val startLat: Double? = null,
  val startLng: Double? = null,
  val startAddress: String? = null,
  val endLat: Double? = null,
  val endLng: Double? = null,
  val endAddress: String? = null,
  val distanceKm: Double = 0.0,
)

@Serializable
data class TourPointDto(
  val lat: Double,
  val lng: Double,
  val accuracy: Double? = null,
  val capturedAt: String? = null,
  val seq: Long? = null,
)

@Serializable
data class TourDetailDto(
  val id: Long,
  val clientUuid: String? = null,
  val status: String? = null,
  val startedAt: String? = null,
  val endedAt: String? = null,
  val startLat: Double? = null,
  val startLng: Double? = null,
  val startAddress: String? = null,
  val endLat: Double? = null,
  val endLng: Double? = null,
  val endAddress: String? = null,
  val distanceKm: Double = 0.0,
  val points: List<TourPointDto> = emptyList(),
)

@Serializable
data class StartTourRequest(
  val clientUuid: String,
  val startedAt: String,
  val lat: Double? = null,
  val lng: Double? = null,
  val address: String? = null,
)

@Serializable
data class AddPointsRequest(
  val points: List<TourPointDto>,
)

@Serializable
data class EndTourRequest(
  val endedAt: String,
  val lat: Double? = null,
  val lng: Double? = null,
  val address: String? = null,
  val distanceKm: Double = 0.0,
  val points: List<TourPointDto> = emptyList(),
)

@Serializable
data class GeotagDto(
  val id: Long,
  val employeeCode: String? = null,
  val name: String? = null,
  val lat: Double? = null,
  val lng: Double? = null,
  val address: String? = null,
  val remark: String? = null,
  val capturedAt: String? = null,
)

@Serializable
data class CreateGeotagRequest(
  val lat: Double? = null,
  val lng: Double? = null,
  val address: String? = null,
  val photo: String? = null,
  val remark: String? = null,
)
