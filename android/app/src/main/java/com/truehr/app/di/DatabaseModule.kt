package com.truehr.app.di

import android.content.Context
import androidx.room.Room
import com.truehr.app.data.local.db.TourDao
import com.truehr.app.data.local.db.TrueHrDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

  @Provides @Singleton
  fun database(@ApplicationContext context: Context): TrueHrDatabase =
    Room.databaseBuilder(context, TrueHrDatabase::class.java, "truehr.db")
      .fallbackToDestructiveMigration()
      .build()

  @Provides @Singleton
  fun tourDao(db: TrueHrDatabase): TourDao = db.tourDao()
}
