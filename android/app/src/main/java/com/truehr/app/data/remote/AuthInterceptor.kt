package com.truehr.app.data.remote

import com.truehr.app.data.local.TokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject

/** Attaches the bearer token (if present) to every outgoing request. */
class AuthInterceptor @Inject constructor(
  private val tokenStore: TokenStore,
) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val token = runBlocking { tokenStore.current() }
    val request = if (token.isNullOrBlank()) {
      chain.request()
    } else {
      chain.request().newBuilder()
        .addHeader("Authorization", "Bearer $token")
        .build()
    }
    return chain.proceed(request)
  }
}
