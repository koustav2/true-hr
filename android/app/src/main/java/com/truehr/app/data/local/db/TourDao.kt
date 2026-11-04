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

  // Only the signed-in user's rows (rows from before v2 have no owner and belong
  // to whoever was signed in during the update), and never parked ones.
  @Query("SELECT * FROM tours WHERE startSynced=0 AND parked=0 AND (ownerUserId IS NULL OR ownerUserId=:owner)")
  suspend fun toursNeedingStartSync(owner: String): List<TourEntity>

  @Query("SELECT * FROM tours WHERE serverId IS NOT NULL AND parked=0 AND (ownerUserId IS NULL OR ownerUserId=:owner)")
  suspend fun toursWithServer(owner: String): List<TourEntity>

  @Query("UPDATE tours SET parked=1, lastError=:error WHERE localId=:localId")
  suspend fun parkTour(localId: Long, error: String?)

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

  @Query("SELECT * FROM tour_points WHERE tourLocalId=:tourLocalId AND synced=0 AND parked=0 ORDER BY seq")
  suspend fun unsyncedPoints(tourLocalId: Long): List<TourPointEntity>

  @Query("UPDATE tour_points SET parked=1 WHERE id IN (:ids)")
  suspend fun parkPoints(ids: List<Long>)

  @Query("SELECT COUNT(*) FROM tour_points WHERE tourLocalId=:tourLocalId AND synced=0 AND parked=0")
  suspend fun unsyncedPointCount(tourLocalId: Long): Int

  @Query("SELECT COALESCE(MAX(seq), -1) FROM tour_points WHERE tourLocalId=:tourLocalId")
  suspend fun maxSeq(tourLocalId: Long): Long

  @Query("UPDATE tour_points SET synced=1 WHERE id IN (:ids)")
  suspend fun markPointsSynced(ids: List<Long>)

  // ── Geotags ──────────────────────────────────────────────────────────────
  @Insert
  suspend fun insertGeotag(geotag: GeotagEntity): Long

  @Query("SELECT * FROM geotags WHERE synced=0 AND parked=0 AND (ownerUserId IS NULL OR ownerUserId=:owner) ORDER BY id")
  suspend fun unsyncedGeotags(owner: String): List<GeotagEntity>

  @Query("UPDATE geotags SET parked=1, lastError=:error WHERE id=:id")
  suspend fun parkGeotag(id: Long, error: String?)

  // ── Sign-out / account switch (A5) ───────────────────────────────────────
  @Query("DELETE FROM tour_points")
  suspend fun deleteAllPoints()

  @Query("DELETE FROM tours")
  suspend fun deleteAllTours()

  @Query("DELETE FROM geotags")
  suspend fun deleteAllGeotags()

  @Query("DELETE FROM tour_points WHERE tourLocalId IN (SELECT localId FROM tours WHERE ownerUserId IS NOT NULL AND ownerUserId<>:owner)")
  suspend fun deletePointsNotOwnedBy(owner: String)

  @Query("DELETE FROM tours WHERE ownerUserId IS NOT NULL AND ownerUserId<>:owner")
  suspend fun deleteToursNotOwnedBy(owner: String)

  @Query("DELETE FROM geotags WHERE ownerUserId IS NOT NULL AND ownerUserId<>:owner")
  suspend fun deleteGeotagsNotOwnedBy(owner: String)

  @Query("UPDATE geotags SET synced=1 WHERE id=:id")
  suspend fun markGeotagSynced(id: Long)
}
