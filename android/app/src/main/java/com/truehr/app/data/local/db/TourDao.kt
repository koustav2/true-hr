package com.truehr.app.data.local.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface TourDao {

  // ── Tours ────────────────────────────────────────────────────────────────
  @Insert(onConflict = OnConflictStrategy.IGNORE)
  suspend fun insertTour(tour: TourEntity): Long

  @Update
  suspend fun updateTour(tour: TourEntity)

  @Query("SELECT * FROM tours WHERE status='ACTIVE' ORDER BY localId DESC LIMIT 1")
  fun activeTourFlow(): Flow<TourEntity?>

  @Query("SELECT * FROM tours WHERE status='ACTIVE' ORDER BY localId DESC LIMIT 1")
  suspend fun getActiveTour(): TourEntity?

  @Query("SELECT * FROM tours WHERE localId=:localId")
  suspend fun getTour(localId: Long): TourEntity?

  @Query("SELECT * FROM tours WHERE startSynced=0")
  suspend fun toursNeedingStartSync(): List<TourEntity>

  @Query("SELECT * FROM tours WHERE serverId IS NOT NULL")
  suspend fun toursWithServer(): List<TourEntity>

  @Query("UPDATE tours SET serverId=:serverId, startSynced=1 WHERE localId=:localId")
  suspend fun markStartSynced(localId: Long, serverId: Long)

  @Query("UPDATE tours SET endSynced=1 WHERE localId=:localId")
  suspend fun markEndSynced(localId: Long)

  // ── Points ───────────────────────────────────────────────────────────────
  @Insert(onConflict = OnConflictStrategy.IGNORE)
  suspend fun insertPoint(point: TourPointEntity): Long

  @Query("SELECT * FROM tour_points WHERE tourLocalId=:tourLocalId ORDER BY seq")
  fun pointsForTourFlow(tourLocalId: Long): Flow<List<TourPointEntity>>

  @Query("SELECT * FROM tour_points WHERE tourLocalId=:tourLocalId ORDER BY seq")
  suspend fun allPoints(tourLocalId: Long): List<TourPointEntity>

  @Query("SELECT * FROM tour_points WHERE tourLocalId=:tourLocalId AND synced=0 ORDER BY seq")
  suspend fun unsyncedPoints(tourLocalId: Long): List<TourPointEntity>

  @Query("SELECT COUNT(*) FROM tour_points WHERE tourLocalId=:tourLocalId AND synced=0")
  suspend fun unsyncedPointCount(tourLocalId: Long): Int

  @Query("SELECT COALESCE(MAX(seq), -1) FROM tour_points WHERE tourLocalId=:tourLocalId")
  suspend fun maxSeq(tourLocalId: Long): Long

  @Query("UPDATE tour_points SET synced=1 WHERE id IN (:ids)")
  suspend fun markPointsSynced(ids: List<Long>)

  // ── Geotags ──────────────────────────────────────────────────────────────
  @Insert
  suspend fun insertGeotag(geotag: GeotagEntity): Long

  @Query("SELECT * FROM geotags WHERE synced=0 ORDER BY id")
  suspend fun unsyncedGeotags(): List<GeotagEntity>

  @Query("UPDATE geotags SET synced=1 WHERE id=:id")
  suspend fun markGeotagSynced(id: Long)
}
