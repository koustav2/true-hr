package com.truehr.app.push

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import com.truehr.app.data.local.TokenStore
import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.DeviceTokenRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume

/**
 * Ties the device's FCM token to the signed-in account:
 *  - [register] after login (and on app start while logged in) — the backend
 *    re-points the token to whoever is signed in on this device
 *  - [unregister] on logout — a signed-out device receives no pushes
 * All calls are best-effort no-ops when Firebase isn't configured
 * (google-services.json absent) or the network call fails.
 */
@Singleton
class PushTokenManager @Inject constructor(
  @ApplicationContext private val context: Context,
  private val api: ApiService,
  private val tokenStore: TokenStore,
) {
  private val firebaseReady: Boolean get() = FirebaseApp.getApps(context).isNotEmpty()

  suspend fun register() {
    if (!firebaseReady || tokenStore.current() == null) return
    val fcmToken = currentFcmToken() ?: return
    runCatching { api.registerDevice(DeviceTokenRequest(fcmToken)) }
  }

  /** Call while the auth token is still valid (i.e. before TokenStore.clear()). */
  suspend fun unregister() {
    if (!firebaseReady) return
    val fcmToken = currentFcmToken() ?: return
    runCatching { api.unregisterDevice(DeviceTokenRequest(fcmToken)) }
  }

  private suspend fun currentFcmToken(): String? = suspendCancellableCoroutine { cont ->
    FirebaseMessaging.getInstance().token
      .addOnSuccessListener { cont.resume(it) }
      .addOnFailureListener { cont.resume(null) }
  }
}
