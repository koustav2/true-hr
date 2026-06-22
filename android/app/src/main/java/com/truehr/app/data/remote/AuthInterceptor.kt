package com.truehr.app.data.remote

import com.truehr.app.data.SessionManager
import com.truehr.app.data.local.TokenStore
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject

/** Attaches the bearer token to every request, and forces a sign-out if the server
 *  rejects that token (401) — so an expired/invalid session can't leave the app stuck. */
class AuthInterceptor @Inject constructor(
  private val tokenStore: TokenStore,
  private val sessionManager: SessionManager,
) : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val token = runBlocking { tokenStore.current() }
    val hadToken = !token.isNullOrBlank()
    val request = if (!hadToken) {
      chain.request()
    } else {
      chain.request().newBuilder()
        .addHeader("Authorization", "Bearer $token")
        .build()
    }
    val response = chain.proceed(request)

    // A request we authenticated came back 401 → the token is dead. Drop it and log out.
    // (Unauthenticated calls like login can 401 on bad credentials — those are left alone.)
    if (response.code == 401 && hadToken) {
      runBlocking { tokenStore.clear() }
      sessionManager.forceLogout()
    }
    return response
  }
}
