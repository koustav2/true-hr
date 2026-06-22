package com.truehr.app.data.local.db

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

// A tour created on-device. It is recorded LOCALLY first (offline-safe) and reconciled
// to the server by client_uuid. serverId is filled once the start has been synced.
@Entity(tableName = "tours", indices = [Index(value = ["clientUuid"], unique = true)])
data class TourEntity(
  @PrimaryKey(autoGenerate = true) val localId: Long = 0,
  val clientUuid: String,
  val serverId: Long? = null,
  val status: String = "ACTIVE",        // ACTIVE | ENDED
  val startedAt: String,                 // ISO-8601 UTC
  val startLat: Double? = null,
  val startLng: Double? = null,
  val startAddress: String? = null,
  val endedAt: String? = null,
  val endLat: Double? = null,
  val endLng: Double? = null,
  val endAddress: String? = null,
  val distanceKm: Double = 0.0,
  val startSynced: Boolean = false,
  val endSynced: Boolean = false,
)

// One GPS fix on a tour's path. Buffered locally; uploaded in batches when online.
@Entity(
  tableName = "tour_points",
  indices = [Index(value = ["tourLocalId"]), Index(value = ["tourLocalId", "seq"], unique = true)],
)
data class TourPointEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  val tourLocalId: Long,
  val seq: Long,
  val lat: Double,
  val lng: Double,
  val accuracy: Double? = null,
  val capturedAt: String,
  val synced: Boolean = false,
)

// A geo-tagged photo, buffered locally and uploaded when online.
@Entity(tableName = "geotags")
data class GeotagEntity(
  @PrimaryKey(autoGenerate = true) val id: Long = 0,
  val lat: Double? = null,
  val lng: Double? = null,
  val address: String? = null,
  val photo: String,                     // base64 jpeg
  val remark: String? = null,
  val capturedAt: String,
  val synced: Boolean = false,
)
