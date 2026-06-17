package com.truehr.app.presentation.splash

import androidx.lifecycle.ViewModel
import com.truehr.app.domain.repository.AuthRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

@HiltViewModel
class SplashViewModel @Inject constructor(
  authRepository: AuthRepository,
) : ViewModel() {
  val isLoggedIn: Flow<Boolean> = authRepository.isLoggedIn
}
