package com.truehr.app.domain.model

data class LatLngPoint(val lat: Double, val lng: Double)

// The currently-running tour (local-only state that drives the Live Tracking screen).
data class ActiveTour(
  val localId: Long,
  val serverId: Long?,
  val startedAt: String,
  val startLat: Double?,
  val startLng: Double?,
)

// A tour as stored on the server (for history: Tour Details).
data class Tour(
  val id: Long,
  val status: String,
  val startedAt: String?,
  val endedAt: String?,
  val startLat: Double?,
  val startLng: Double?,
  val startAddress: String?,
  val endLat: Double?,
  val endLng: Double?,
  val endAddress: String?,
  val distanceKm: Double,
  val points: List<LatLngPoint> = emptyList(),
)

// A geo-tagged photo entry (Geo Tag List).
data class Geotag(
  val id: Long,
  val name: String?,
  val employeeCode: String?,
  val lat: Double?,
  val lng: Double?,
  val address: String?,
  val remark: String?,
  val capturedAt: String?,
)
