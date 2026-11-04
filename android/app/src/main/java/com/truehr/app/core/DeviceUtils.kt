package com.truehr.app.core

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.widget.Toast
import androidx.activity.result.ActivityResultLauncher
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/** Location permission + one-shot fix used by attendance, OD, geo-tag and tours. */
object LocationHelper {
  /** Ask for both: Android 12+ lets the person grant only "approximate", which we accept. */
  val PERMISSIONS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

  const val MSG_DENIED = "Location permission is needed. Allow location (precise or approximate) for TrueHR in Settings."
  const val MSG_OFF = "Location is turned off. Turn on Location (GPS) and try again."
  const val MSG_NO_FIX = "We couldn't get your location. Move to an open area, check that Location is on, and try again."

  fun hasFine(ctx: Context) =
    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  fun hasAny(ctx: Context) = hasFine(ctx) ||
    ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

  /** Result map from RequestMultiplePermissions → granted at least approximate location. */
  fun granted(result: Map<String, Boolean>) = result.values.any { it }

  fun isEnabled(ctx: Context): Boolean {
    val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
    return LocationManagerCompat.isLocationEnabled(lm)
  }

  sealed interface Fix {
    data class Ok(val location: Location) : Fix
    data class Failed(val message: String) : Fix
  }

  /** Current fix (precise when allowed, otherwise approximate), or a readable reason why not. */
  @SuppressLint("MissingPermission")
  suspend fun current(ctx: Context, timeoutMs: Long = 20_000): Fix {
    if (!hasAny(ctx)) return Fix.Failed(MSG_DENIED)
    if (!isEnabled(ctx)) return Fix.Failed(MSG_OFF)
    val fused = LocationServices.getFusedLocationProviderClient(ctx)
    val priority = if (hasFine(ctx)) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
    val loc = try {
      withTimeoutOrNull(timeoutMs) {
        suspendCancellableCoroutine<Location?> { cont ->
          val cts = CancellationTokenSource()
          fused.getCurrentLocation(priority, cts.token)
            .addOnSuccessListener { cont.resume(it) }
            .addOnFailureListener { cont.resume(null) }
          cont.invokeOnCancellation { cts.cancel() }
        }
      } ?: suspendCancellableCoroutine<Location?> { cont ->
        fused.lastLocation.addOnSuccessListener { cont.resume(it) }.addOnFailureListener { cont.resume(null) }
      }
    } catch (_: SecurityException) { return Fix.Failed(MSG_DENIED) }
    return if (loc != null) Fix.Ok(loc) else Fix.Failed(MSG_NO_FIX)
  }
}

/** Starting another app (browser, camera, PDF viewer) can fail when none is installed. */
fun Context.startActivitySafely(intent: Intent, whenMissing: String = "No app on this phone can open this."): Boolean =
  try { startActivity(intent); true }
  catch (_: ActivityNotFoundException) { Toast.makeText(this, whenMissing, Toast.LENGTH_LONG).show(); false }
  catch (_: SecurityException) { Toast.makeText(this, whenMissing, Toast.LENGTH_LONG).show(); false }

/** Launch a camera/file picker contract; returns false (and toasts) when no app handles it. */
fun <I> ActivityResultLauncher<I>.launchSafely(ctx: Context, input: I, whenMissing: String = "No camera app is available on this phone."): Boolean =
  try { launch(input); true }
  catch (_: ActivityNotFoundException) { Toast.makeText(ctx, whenMissing, Toast.LENGTH_LONG).show(); false }
