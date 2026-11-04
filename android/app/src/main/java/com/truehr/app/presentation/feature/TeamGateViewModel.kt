package com.truehr.app.presentation.feature

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.domain.repository.ProfileRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * E2/E32: "does the signed-in person have reportees?" (= /me/team is non-empty).
 * Team tiles, team wording and Assign Task show only when it is true. If the call
 * fails the employee (no-team) layout is used.
 */
@HiltViewModel
class TeamGateViewModel @Inject constructor(private val repo: ProfileRepository) : ViewModel() {
  val hasTeam = MutableStateFlow(false)
  init {
    viewModelScope.launch {
      try { hasTeam.value = repo.myTeam().isNotEmpty() }
      catch (e: Exception) { Log.w("TeamGate", "team check failed", e) }
    }
  }
}
