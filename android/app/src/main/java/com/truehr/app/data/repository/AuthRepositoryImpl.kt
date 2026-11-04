package com.truehr.app.data.repository

import com.truehr.app.data.SessionCleaner
import com.truehr.app.data.local.SessionState
import com.truehr.app.data.local.TokenStore
import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.ChangePasswordRequest
import com.truehr.app.data.remote.dto.LoginRequest
import com.truehr.app.domain.model.SessionUser
import com.truehr.app.domain.repository.AuthRepository
import com.truehr.app.domain.repository.LoginResult
import com.truehr.app.push.PushTokenManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject

class AuthRepositoryImpl @Inject constructor(
  private val api: ApiService,
  private val tokenStore: TokenStore,
  private val pushTokenManager: PushTokenManager,
  tourBuffer: TourRepositoryImpl,
) : AuthRepository {

  private val cleaner = SessionCleaner(pushTokenManager, tourBuffer, tokenStore)

  override val isLoggedIn: Flow<Boolean> = tokenStore.token.map { !it.isNullOrBlank() }
  override val sessionState: Flow<SessionState> = tokenStore.sessionState

  override suspend fun login(email: String, password: String): LoginResult {
    // The username may carry stray spaces from auto-fill; a password is sent exactly
    // as typed (a leading/trailing space can be part of it).
    val res = api.login(LoginRequest(email.trim(), password))
    if (res.otpRequired) return LoginResult(otpRequired = true, maskedEmail = res.email)
    return LoginResult(user = establish(res))
  }

  // The masked address the server shows ("s****@…") is for display only; the code
  // is verified against the username the person typed.
  override suspend fun verifyLoginOtp(email: String, otp: String): SessionUser =
    establish(api.loginVerifyOtp(com.truehr.app.data.remote.dto.LoginOtpRequest(email.trim(), otp.trim())))

  private suspend fun establish(res: com.truehr.app.data.remote.dto.LoginResponse): SessionUser {
    val token = res.token ?: throw IllegalStateException("The server did not start a session. Please try again.")
    val user = res.user
    val must = user?.mustChangePassword ?: false
    val uid = user?.id?.toString()
    // The forced-change flag is stored with the token, so killing the app on the
    // change-password screen cannot skip it (Splash routes back there).
    tokenStore.save(token, user?.email, user?.role, uid, must)
    if (uid != null) cleaner.adopt(uid)
    runCatching { pushTokenManager.register() }
    return SessionUser(email = user?.email.orEmpty(), role = user?.role.orEmpty(), mustChangePassword = must)
  }

  override suspend fun mustChangePassword(): Boolean = tokenStore.mustChangePassword()

  override suspend fun changePassword(current: String?, new: String) {
    api.changePassword(ChangePasswordRequest(currentPassword = current?.takeIf { it.isNotEmpty() }, newPassword = new))
    tokenStore.setMustChangePassword(false)
  }

  override suspend fun forgotPassword(email: String) {
    api.forgotPassword(com.truehr.app.data.remote.dto.ForgotPasswordRequest(email.trim()))
  }

  override suspend fun resetPassword(email: String, otp: String, newPassword: String) {
    api.resetPassword(com.truehr.app.data.remote.dto.ResetPasswordRequest(email.trim(), otp.trim(), newPassword))
  }

  override suspend fun logout() { cleaner.signOut() }
}
