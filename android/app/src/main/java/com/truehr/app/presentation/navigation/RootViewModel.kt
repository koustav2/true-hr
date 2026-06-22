package com.truehr.app.presentation.navigation

import androidx.lifecycle.ViewModel
import com.truehr.app.data.SessionManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharedFlow
import javax.inject.Inject

@HiltViewModel
class RootViewModel @Inject constructor(
  sessionManager: SessionManager,
) : ViewModel() {
  val logoutEvents: SharedFlow<Unit> = sessionManager.logoutEvents
}
