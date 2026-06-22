package com.truehr.app.data.repository

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.truehr.app.core.pathDistanceKm
import com.truehr.app.data.local.db.GeotagEntity
import com.truehr.app.data.local.db.TourDao
import com.truehr.app.data.local.db.TourEntity
import com.truehr.app.data.local.db.TourPointEntity
import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.AddPointsRequest
import com.truehr.app.data.remote.dto.CreateGeotagRequest
import com.truehr.app.data.remote.dto.EndTourRequest
import com.truehr.app.data.remote.dto.StartTourRequest
import com.truehr.app.data.remote.dto.TourDto
import com.truehr.app.data.remote.dto.TourPointDto
import com.truehr.app.domain.model.ActiveTour
import com.truehr.app.domain.model.Geotag
import com.truehr.app.domain.model.LatLngPoint
import com.truehr.app.domain.model.Tour
import com.truehr.app.domain.repository.TourRepository
import com.truehr.app.tracking.TourSyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TourRepositoryImpl @Inject constructor(
  private val dao: TourDao,
  private val api: ApiService,
  @ApplicationContext private val context: Context,
) : TourRepository {

  override fun activeTour(): Flow<ActiveTour?> =
    dao.activeTourFlow().map { t ->
      t?.let { ActiveTour(it.localId, it.serverId, it.startedAt, it.startLat, it.startLng) }
    }

  @OptIn(ExperimentalCoroutinesApi::class)
  override fun activePath(): Flow<List<LatLngPoint>> =
    dao.activeTourFlow().flatMapLatest { t ->
      if (t == null) flowOf(emptyList<LatLngPoint>())
      else dao.pointsForTourFlow(t.localId).map { pts -> pts.map { LatLngPoint(it.lat, it.lng) } }
    }

  override suspend fun startTour(lat: Double?, lng: Double?, address: String?): Long {
    val localId = dao.insertTour(
      TourEntity(
        clientUuid = UUID.randomUUID().toString(),
        status = "ACTIVE",
        startedAt = isoNow(),
        startLat = lat, startLng = lng, startAddress = address,
      ),
    )
    enqueueSync()
    return localId
  }

  override suspend fun recordPoint(tourLocalId: Long, lat: Double, lng: Double, accuracy: Double?) {
    val seq = dao.maxSeq(tourLocalId) + 1
    dao.insertPoint(
      TourPointEntity(
        tourLocalId = tourLocalId, seq = seq, lat = lat, lng = lng,
        accuracy = accuracy, capturedAt = isoNow(),
      ),
    )
  }

  override suspend fun endTour(tourLocalId: Long, lat: Double?, lng: Double?, address: String?) {
    val tour = dao.getTour(tourLocalId) ?: return
    val pts = dao.allPoints(tourLocalId).map { LatLngPoint(it.lat, it.lng) }
    val dist = if (pts.size >= 2) pathDistanceKm(pts) else 0.0
    dao.updateTour(
      tour.copy(
        status = "ENDED", endedAt = isoNow(),
        endLat = lat, endLng = lng, endAddress = address,
        distanceKm = dist, endSynced = false,
      ),
    )
    enqueueSync()
  }

  override suspend fun recordGeotag(lat: Double?, lng: Double?, address: String?, photoBase64: String, remark: String?) {
    dao.insertGeotag(
      GeotagEntity(lat = lat, lng = lng, address = address, photo = photoBase64, remark = remark, capturedAt = isoNow()),
    )
    enqueueSync()
  }

  override suspend fun syncNow(): Boolean {
    return try {
      // 1) Reconcile offline-created tours (get their server id).
      dao.toursNeedingStartSync().forEach { t ->
        val dto = api.tourStart(StartTourRequest(t.clientUuid, t.startedAt, t.startLat, t.startLng, t.startAddress))
        dao.markStartSynced(t.localId, dto.id)
      }
      // 2) Flush buffered points, then 3) finalize ended tours.
      dao.toursWithServer().forEach { t ->
        val serverId = t.serverId ?: return@forEach
        dao.unsyncedPoints(t.localId).chunked(500).forEach { batch ->
          api.tourAddPoints(serverId, AddPointsRequest(batch.map {
            TourPointDto(it.lat, it.lng, it.accuracy, it.capturedAt, it.seq)
          }))
          dao.markPointsSynced(batch.map { it.id })
        }
        val fresh = dao.getTour(t.localId) ?: return@forEach
        if (fresh.status == "ENDED" && !fresh.endSynced && dao.unsyncedPointCount(t.localId) == 0) {
          api.tourEnd(serverId, EndTourRequest(
            endedAt = fresh.endedAt ?: isoNow(),
            lat = fresh.endLat, lng = fresh.endLng, address = fresh.endAddress,
            distanceKm = fresh.distanceKm,
          ))
          dao.markEndSynced(t.localId)
        }
      }
      // 4) Upload buffered geo-tags.
      dao.unsyncedGeotags().forEach { g ->
        api.geotagCreate(CreateGeotagRequest(g.lat, g.lng, g.address, g.photo, g.remark))
        dao.markGeotagSynced(g.id)
      }
      true
    } catch (e: Exception) {
      false
    }
  }

  override fun enqueueSync() {
    val req = OneTimeWorkRequestBuilder<TourSyncWorker>()
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork("tour-sync", ExistingWorkPolicy.APPEND_OR_REPLACE, req)
  }

  override suspend fun remoteTours(from: String?, to: String?): List<Tour> =
    api.tours(from, to).map { it.toDomain() }

  override suspend fun remoteTourDetail(id: Long): Tour {
    val d = api.tourDetail(id)
    return Tour(
      id = d.id, status = d.status ?: "ENDED", startedAt = d.startedAt, endedAt = d.endedAt,
      startLat = d.startLat, startLng = d.startLng, startAddress = d.startAddress,
      endLat = d.endLat, endLng = d.endLng, endAddress = d.endAddress, distanceKm = d.distanceKm,
      points = d.points.map { LatLngPoint(it.lat, it.lng) },
    )
  }

  override suspend fun remoteGeotags(from: String?, to: String?): List<Geotag> =
    api.geotags(from, to).map {
      Geotag(it.id, it.name, it.employeeCode, it.lat, it.lng, it.address, it.remark, it.capturedAt)
    }

  private fun TourDto.toDomain() = Tour(
    id = id, status = status ?: "ENDED", startedAt = startedAt, endedAt = endedAt,
    startLat = startLat, startLng = startLng, startAddress = startAddress,
    endLat = endLat, endLng = endLng, endAddress = endAddress, distanceKm = distanceKm,
  )

  private fun isoNow(): String {
    val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }
    return fmt.format(Date())
  }
}
