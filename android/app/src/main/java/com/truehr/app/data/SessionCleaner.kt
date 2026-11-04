package com.truehr.app.data

import com.truehr.app.data.local.SessionStore
import retrofit2.HttpException
import java.io.IOException

/** The offline buffer (tours, path points, geo-tags) as sign-out sees it. */
interface LocalBufferStore {
  /** Try to upload what is buffered while the session is still valid. */
  suspend fun flush()
  /** Delete everything buffered on this device. */
  suspend fun clearAll()
  /** Delete rows that belong to another account. */
  suspend fun keepOnly(userId: String)
}

/** Removes this device's push token from the signed-in account. Returns false on failure. */
interface DeviceTokenUnregistrar {
  suspend fun unregister(): Boolean
}

/**
 * Sign-out in the only safe order (A5/A11):
 *  1. upload buffered data while the token still works (best-effort),
 *  2. unregister the push token (needs the token — otherwise the next person
 *     signing in on another phone keeps getting this person's notifications),
 *  3. wipe the local buffer so nothing uploads under the next login,
 *  4. clear the session.
 * Each step is isolated: a failure in one never skips the later ones.
 */
class SessionCleaner(
  private val push: DeviceTokenUnregistrar,
  private val buffer: LocalBufferStore,
  private val session: SessionStore,
) {
  data class Report(val flushed: Boolean, val pushUnregistered: Boolean, val bufferCleared: Boolean)

  suspend fun signOut(): Report {
    val hadSession = runCatching { session.current() }.getOrNull() != null
    val flushed = hadSession && runCatching { buffer.flush() }.isSuccess
    val pushOk = hadSession && runCatching { push.unregister() }.getOrDefault(false)
    val cleared = runCatching { buffer.clearAll() }.isSuccess
    runCatching { session.clear() }
    return Report(flushed, pushOk, cleared)
  }

  /** After a new sign-in: drop any rows another account left behind. */
  suspend fun adopt(userId: String) { runCatching { buffer.keepOnly(userId) } }
}

/** Which upload failures are permanent (park the item) vs. retryable. */
object SyncPolicy {
  fun isPermanent(e: Throwable): Boolean = when (e) {
    is HttpException -> e.code() in 400..499 && e.code() !in setOf(401, 408, 429)
    is IOException -> false
    else -> false
  }
}
