package com.truehr.app.tracking

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.truehr.app.MainActivity
import com.truehr.app.domain.repository.TourRepository
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import javax.inject.Inject

// Foreground service: keeps high-accuracy GPS running (screen off / app backgrounded)
// for the duration of a tour. Each fix is written to the local Room buffer — independent
// of any network — and a sync is nudged periodically.
@AndroidEntryPoint
class TourTrackingService : Service() {

  @Inject lateinit var repo: TourRepository

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private lateinit var fused: FusedLocationProviderClient
  private var tourLocalId: Long = -1L
  private var pointsSinceSync = 0

  private val callback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      val loc = result.lastLocation ?: return
      val id = tourLocalId
      if (id <= 0) return
      scope.launch {
        repo.recordPoint(id, loc.latitude, loc.longitude, loc.accuracy.toDouble())
        if (++pointsSinceSync >= SYNC_EVERY_N_POINTS) {
          pointsSinceSync = 0
          repo.enqueueSync()
        }
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    fused = LocationServices.getFusedLocationProviderClient(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopTracking()
      return START_NOT_STICKY
    }
    tourLocalId = intent?.getLongExtra(EXTRA_TOUR_ID, -1L) ?: -1L
    startForegroundNotification()
    startLocationUpdates()
    return START_STICKY
  }

  private fun startLocationUpdates() {
    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, INTERVAL_MS)
      .setMinUpdateIntervalMillis(FASTEST_MS)
      .setMinUpdateDistanceMeters(MIN_DISTANCE_M)
      .build()
    try {
      fused.requestLocationUpdates(request, callback, mainLooper)
    } catch (e: SecurityException) {
      stopSelf()
    }
  }

  private fun stopTracking() {
    runCatching { fused.removeLocationUpdates(callback) }
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    runCatching { fused.removeLocationUpdates(callback) }
    scope.cancel()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun startForegroundNotification() {
    val mgr = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(CHANNEL_ID, "Tour tracking", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Active while a tour is being tracked"
        setShowBadge(false)
      }
      mgr.createNotificationChannel(channel)
    }
    val openApp = android.app.PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java),
      android.app.PendingIntent.FLAG_IMMUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val notif: Notification = androidx.core.app.NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Tour in progress")
      .setContentText("Your route is being recorded.")
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setOngoing(true)
      .setContentIntent(openApp)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ServiceCompat.startForeground(this, NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIF_ID, notif)
    }
  }

  companion object {
    private const val CHANNEL_ID = "tour_tracking"
    private const val NOTIF_ID = 4201
    private const val INTERVAL_MS = 10_000L
    private const val FASTEST_MS = 5_000L
    private const val MIN_DISTANCE_M = 15f
    private const val SYNC_EVERY_N_POINTS = 6
    const val ACTION_STOP = "com.truehr.app.tracking.STOP"
    const val EXTRA_TOUR_ID = "tour_local_id"

    fun start(context: Context, tourLocalId: Long) {
      val intent = Intent(context, TourTrackingService::class.java).apply {
        putExtra(EXTRA_TOUR_ID, tourLocalId)
      }
      androidx.core.content.ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      val intent = Intent(context, TourTrackingService::class.java).apply { action = ACTION_STOP }
      context.startService(intent)
    }
  }
}
