package com.truehr.app.data.repository

import com.truehr.app.data.local.TokenStore
import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.ChangePasswordRequest
import com.truehr.app.data.remote.dto.LoginRequest
import com.truehr.app.domain.model.SessionUser
import com.truehr.app.domain.repository.AuthRepository
import com.truehr.app.domain.repository.LoginResult
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject

class AuthRepositoryImpl @Inject constructor(
  private val api: ApiService,
  private val tokenStore: TokenStore,
) : AuthRepository {

  override val isLoggedIn: Flow<Boolean> = tokenStore.token.map { !it.isNullOrBlank() }

  override suspend fun login(email: String, password: String): LoginResult {
    // Trim stray whitespace some keyboards / auto-fill prepend to the fields.
    val res = api.login(LoginRequest(email.trim(), password.trim()))
    if (res.otpRequired) return LoginResult(otpRequired = true, maskedEmail = res.email)
    return LoginResult(user = establish(res))
  }

  override suspend fun verifyLoginOtp(email: String, otp: String): SessionUser =
    establish(api.loginVerifyOtp(com.truehr.app.data.remote.dto.LoginOtpRequest(email.trim(), otp.trim())))

  private suspend fun establish(res: com.truehr.app.data.remote.dto.LoginResponse): SessionUser {
    val token = res.token ?: throw IllegalStateException("No session token in response")
    val user = res.user
    tokenStore.save(token, user?.email, user?.role)
    return SessionUser(
      email = user?.email.orEmpty(),
      role = user?.role.orEmpty(),
      mustChangePassword = user?.mustChangePassword ?: false,
    )
  }

  override suspend fun changePassword(new: String) {
    api.changePassword(ChangePasswordRequest(new))
  }

  override suspend fun forgotPassword(email: String) {
    api.forgotPassword(com.truehr.app.data.remote.dto.ForgotPasswordRequest(email.trim()))
  }

  override suspend fun resetPassword(email: String, otp: String, newPassword: String) {
    api.resetPassword(com.truehr.app.data.remote.dto.ResetPasswordRequest(email.trim(), otp.trim(), newPassword))
  }

  override suspend fun logout() = tokenStore.clear()
}
