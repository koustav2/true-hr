package com.truehr.app

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import coil.ImageLoader
import coil.ImageLoaderFactory
import dagger.hilt.android.HiltAndroidApp
import okhttp3.OkHttpClient
import javax.inject.Inject

@HiltAndroidApp
class TrueHrApp : Application(), ImageLoaderFactory, Configuration.Provider {
  // Reuse the authenticated OkHttp client (with the bearer-token interceptor) so Coil
  // can load token-protected attendance photos.
  @Inject lateinit var okHttpClient: OkHttpClient

  // Lets WorkManager construct @HiltWorker-annotated workers (the tour sync worker).
  @Inject lateinit var workerFactory: HiltWorkerFactory

  override val workManagerConfiguration: Configuration
    get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

  override fun newImageLoader(): ImageLoader =
    ImageLoader.Builder(this)
      .okHttpClient(okHttpClient)
      .crossfade(true)
      .build()
}
