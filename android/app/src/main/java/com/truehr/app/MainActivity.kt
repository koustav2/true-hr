package com.truehr.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.truehr.app.presentation.navigation.AppNavGraph
import com.truehr.app.presentation.theme.TrueHrTheme
import com.truehr.app.push.EXTRA_PUSH_ROUTE
import com.truehr.app.push.PendingPushRoute
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    capturePushRoute(intent)
    setContent {
      TrueHrTheme {
        AppNavGraph()
      }
    }
  }

  // launchMode=singleTop: a notification tapped while the app is alive lands here.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    capturePushRoute(intent)
  }

  private fun capturePushRoute(intent: Intent?) {
    intent?.getStringExtra(EXTRA_PUSH_ROUTE)?.let { PendingPushRoute.set(it) }
  }
}
