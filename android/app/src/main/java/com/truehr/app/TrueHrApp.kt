package com.truehr.app

import android.app.Application
import coil.ImageLoader
import coil.ImageLoaderFactory
import dagger.hilt.android.HiltAndroidApp
import okhttp3.OkHttpClient
import javax.inject.Inject

@HiltAndroidApp
class TrueHrApp : Application(), ImageLoaderFactory {
  // Reuse the authenticated OkHttp client (with the bearer-token interceptor) so Coil
  // can load token-protected attendance photos.
  @Inject lateinit var okHttpClient: OkHttpClient

  override fun newImageLoader(): ImageLoader =
    ImageLoader.Builder(this)
      .okHttpClient(okHttpClient)
      .crossfade(true)
      .build()
}
