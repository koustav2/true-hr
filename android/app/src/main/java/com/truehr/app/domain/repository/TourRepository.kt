package com.truehr.app.domain.repository

import com.truehr.app.domain.model.ActiveTour
import com.truehr.app.domain.model.Geotag
import com.truehr.app.domain.model.LatLngPoint
import com.truehr.app.domain.model.Tour
import kotlinx.coroutines.flow.Flow

interface TourRepository {
  /** The currently-running tour, or null. Drives the Start/End toggle. */
  fun activeTour(): Flow<ActiveTour?>

  /** The buffered path of the active tour (for the live polyline). */
  fun activePath(): Flow<List<LatLngPoint>>

  /** Create a tour locally (offline-safe) and queue it for sync. Returns local id. */
  suspend fun startTour(lat: Double?, lng: Double?, address: String?): Long

  /** Append a GPS fix to a tour's local buffer; called by the tracking service. */
  suspend fun recordPoint(tourLocalId: Long, lat: Double, lng: Double, accuracy: Double?)

  /** Close a tour locally, compute its distance, and queue final sync. */
  suspend fun endTour(tourLocalId: Long, lat: Double?, lng: Double?, address: String?)

  /** Buffer a geo-tagged photo locally and queue it for upload. */
  suspend fun recordGeotag(lat: Double?, lng: Double?, address: String?, photoBase64: String, remark: String?)

  /** Push all buffered data to the server. Returns true if everything synced. Used by the worker. */
  suspend fun syncNow(): Boolean

  /** Enqueue a one-off background sync (network-constrained). */
  fun enqueueSync()

  // Server-backed history (online):
  suspend fun remoteTours(from: String?, to: String?): List<Tour>
  suspend fun remoteTourDetail(id: Long): Tour
  suspend fun remoteGeotags(from: String?, to: String?): List<Geotag>
}
