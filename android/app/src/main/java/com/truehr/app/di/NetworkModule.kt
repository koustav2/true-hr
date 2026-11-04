package com.truehr.app.di

import com.truehr.app.BuildConfig
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.AuthInterceptor
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

  @Provides @Singleton
  fun json(): Json = AppJson

  @Provides @Singleton
  fun okHttp(authInterceptor: AuthInterceptor): OkHttpClient {
    val logging = HttpLoggingInterceptor().apply {
      level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY else HttpLoggingInterceptor.Level.NONE
    }
    return OkHttpClient.Builder()
      .addInterceptor(authInterceptor)
      .addInterceptor(logging)
      .build()
  }

  @Provides @Singleton
  fun retrofit(client: OkHttpClient, json: Json): Retrofit =
    Retrofit.Builder()
      .baseUrl(BuildConfig.BASE_URL)
      .client(client)
      .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
      .build()

  @Provides @Singleton
  fun apiService(retrofit: Retrofit): ApiService = retrofit.create(ApiService::class.java)
}

/**
 * One JSON config for the API. coerceInputValues: an explicit `null` for a
 * non-null field with a default (e.g. `"noticePeriodDays": null`) uses the
 * default instead of failing the whole response.
 */
val AppJson: Json = Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true; explicitNulls = false }
