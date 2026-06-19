package com.truehr.app.domain.repository

import com.truehr.app.domain.model.SessionUser
import kotlinx.coroutines.flow.Flow

interface AuthRepository {
  val isLoggedIn: Flow<Boolean>
  suspend fun login(email: String, password: String): SessionUser
  suspend fun changePassword(new: String)
  suspend fun logout()
}
