package com.truehr.app.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.truehr.app.MainActivity
import com.truehr.app.R
import com.truehr.app.data.local.TokenStore
import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.DeviceTokenRequest
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import javax.inject.Inject

private const val CHANNEL_ID = "truehr_general"
const val EXTRA_PUSH_ROUTE = "push_route"

@AndroidEntryPoint
class TrueHrMessagingService : FirebaseMessagingService() {

  @Inject lateinit var tokenStore: TokenStore
  @Inject lateinit var api: ApiService

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  /** FCM rotated the device token — re-register it for the signed-in user. */
  override fun onNewToken(token: String) {
    scope.launch {
      if (tokenStore.current() != null) {
        runCatching { api.registerDevice(DeviceTokenRequest(token)) }
      }
    }
  }

  /**
   * Backend sends data-only messages, so this fires in foreground AND
   * background and we always build the tray notification ourselves —
   * that's what makes the tap deep-link reliable.
   */
  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    val title = data["title"] ?: message.notification?.title ?: return
    val body = data["body"] ?: message.notification?.body ?: ""
    val route = data["route"] ?: "notifications"

    // Notifications only for a signed-in session (server shouldn't push to a
    // signed-out device anyway — the logout removed its token — but be safe).
    val loggedIn = runBlocking { tokenStore.current() != null }
    if (!loggedIn) return

    showNotification(title, body, route)
  }

  private fun showNotification(title: String, body: String, route: String) {
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) return

    if (Build.VERSION.SDK_INT >= 26) {
      val channel = NotificationChannel(CHANNEL_ID, "TrueHR notifications", NotificationManager.IMPORTANCE_HIGH)
      channel.description = "Leave, attendance, resignation and approval updates"
      getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    // Tapping opens MainActivity carrying the deep-link route.
    val intent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
      putExtra(EXTRA_PUSH_ROUTE, route)
    }
    val pending = PendingIntent.getActivity(
      this, route.hashCode(), intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_launcher_foreground)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(pending)
      .build()

    NotificationManagerCompat.from(this).notify(System.currentTimeMillis().toInt(), notification)
  }

  override fun onDestroy() {
    scope.cancel()
    super.onDestroy()
  }
}
