package com.truehr.app.data.local.db

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
  entities = [TourEntity::class, TourPointEntity::class, GeotagEntity::class],
  version = 2,
  exportSchema = false,
)
abstract class TrueHrDatabase : RoomDatabase() {
  abstract fun tourDao(): TourDao
}

/** 1 → 2: owner + parked columns (keeps buffered tours / geo-tags across the update). */
val MIGRATION_1_2 = object : androidx.room.migration.Migration(1, 2) {
  override fun migrate(db: androidx.sqlite.db.SupportSQLiteDatabase) {
    db.execSQL("ALTER TABLE tours ADD COLUMN ownerUserId TEXT")
    db.execSQL("ALTER TABLE tours ADD COLUMN parked INTEGER NOT NULL DEFAULT 0")
    db.execSQL("ALTER TABLE tours ADD COLUMN lastError TEXT")
    db.execSQL("ALTER TABLE tour_points ADD COLUMN parked INTEGER NOT NULL DEFAULT 0")
    db.execSQL("ALTER TABLE geotags ADD COLUMN ownerUserId TEXT")
    db.execSQL("ALTER TABLE geotags ADD COLUMN parked INTEGER NOT NULL DEFAULT 0")
    db.execSQL("ALTER TABLE geotags ADD COLUMN lastError TEXT")
  }
}
