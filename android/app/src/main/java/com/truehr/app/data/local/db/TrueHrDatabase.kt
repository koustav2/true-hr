package com.truehr.app.data.local.db

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
  entities = [TourEntity::class, TourPointEntity::class, GeotagEntity::class],
  version = 1,
  exportSchema = false,
)
abstract class TrueHrDatabase : RoomDatabase() {
  abstract fun tourDao(): TourDao
}
