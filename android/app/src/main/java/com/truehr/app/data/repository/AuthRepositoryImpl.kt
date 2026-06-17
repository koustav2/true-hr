package com.truehr.app.data.repository

import com.truehr.app.data.local.TokenStore
import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.ChangePasswordRequest
import com.truehr.app.data.remote.dto.LoginRequest
import com.truehr.app.domain.model.SessionUser
import com.truehr.app.domain.repository.AuthRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject

class AuthRepositoryImpl @Inject constructor(
  private val api: ApiService,
  private val tokenStore: TokenStore,
) : AuthRepository {

  override val isLoggedIn: Flow<Boolean> = tokenStore.token.map { !it.isNullOrBlank() }

  override suspend fun login(email: String, password: String): SessionUser {
    // Trim stray whitespace some keyboards / auto-fill prepend to the fields.
    val res = api.login(LoginRequest(email.trim(), password.trim()))
    tokenStore.save(res.token, res.user.email, res.user.role)
    return SessionUser(
      email = res.user.email.orEmpty(),
      role = res.user.role.orEmpty(),
      mustChangePassword = res.user.mustChangePassword,
    )
  }

  override suspend fun changePassword(current: String, new: String) {
    api.changePassword(ChangePasswordRequest(current, new))
  }

  override suspend fun logout() = tokenStore.clear()
}
