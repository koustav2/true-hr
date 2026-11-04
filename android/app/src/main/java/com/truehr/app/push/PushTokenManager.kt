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
) : com.truehr.app.data.DeviceTokenUnregistrar {
  private val firebaseReady: Boolean get() = FirebaseApp.getApps(context).isNotEmpty()

  /** Returns true when the server accepted the token (false = not configured / failed; logged). */
  suspend fun register(): Boolean {
    if (!firebaseReady || tokenStore.current() == null) return false
    val fcmToken = currentFcmToken() ?: run { android.util.Log.w(TAG, "No FCM token available"); return false }
    // Two attempts: a flaky network at app start should not leave pushes off until next launch.
    repeat(2) { attemptNo ->
      try { api.registerDevice(DeviceTokenRequest(fcmToken)); return true }
      catch (e: Exception) {
        android.util.Log.w(TAG, "Device-token registration failed (attempt ${attemptNo + 1})", e)
        if (attemptNo == 0) kotlinx.coroutines.delay(3_000)
      }
    }
    return false
  }

  /** Call while the auth token is still valid (i.e. before TokenStore.clear()). */
  override suspend fun unregister(): Boolean {
    if (!firebaseReady) return true // nothing was ever registered from this build
    val fcmToken = currentFcmToken() ?: return false
    return try { api.unregisterDevice(DeviceTokenRequest(fcmToken)); true }
    catch (e: Exception) { android.util.Log.w(TAG, "Device-token unregister failed", e); false }
  }

  private companion object { const val TAG = "PushTokenManager" }

  private suspend fun currentFcmToken(): String? = suspendCancellableCoroutine { cont ->
    FirebaseMessaging.getInstance().token
      .addOnSuccessListener { cont.resume(it) }
      .addOnFailureListener { cont.resume(null) }
  }
}
