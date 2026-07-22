package com.truehr.app.domain.repository

import com.truehr.app.domain.model.SessionUser
import kotlinx.coroutines.flow.Flow

/** Outcome of the password step: either a session, or "enter the emailed code". */
data class LoginResult(
  val otpRequired: Boolean = false,
  val maskedEmail: String? = null,
  val user: SessionUser? = null,
)

interface AuthRepository {
  val isLoggedIn: Flow<Boolean>
  suspend fun login(email: String, password: String): LoginResult
  suspend fun verifyLoginOtp(email: String, otp: String): SessionUser
  suspend fun changePassword(new: String)
  suspend fun forgotPassword(email: String)
  suspend fun resetPassword(email: String, otp: String, newPassword: String)
  suspend fun logout()
}
