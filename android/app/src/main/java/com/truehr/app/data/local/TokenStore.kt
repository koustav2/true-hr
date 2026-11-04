package com.truehr.app.data.local

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore by preferencesDataStore(name = "truehr_session")

/** Where a stored session should land on app start. */
enum class SessionState { NONE, MUST_CHANGE_PASSWORD, ACTIVE }

/** Session storage contract (an interface so logout clearing is unit-tested with a fake). */
interface SessionStore {
  suspend fun current(): String?
  suspend fun userId(): String?
  suspend fun clear()
}

@Singleton
class TokenStore @Inject constructor(@ApplicationContext private val context: Context) : SessionStore {
  private val tokenKey = stringPreferencesKey("token")
  private val nameKey = stringPreferencesKey("name")
  private val roleKey = stringPreferencesKey("role")
  private val userIdKey = stringPreferencesKey("user_id")
  private val mustChangeKey = booleanPreferencesKey("must_change_password")

  val token: Flow<String?> = context.dataStore.data.map { it[tokenKey] }

  /** NONE (signed out), MUST_CHANGE_PASSWORD (forced first change still due), ACTIVE. */
  val sessionState: Flow<SessionState> = context.dataStore.data.map {
    when {
      it[tokenKey].isNullOrBlank() -> SessionState.NONE
      it[mustChangeKey] == true -> SessionState.MUST_CHANGE_PASSWORD
      else -> SessionState.ACTIVE
    }
  }

  override suspend fun current(): String? = context.dataStore.data.map { it[tokenKey] }.first()
  override suspend fun userId(): String? = context.dataStore.data.map { it[userIdKey] }.first()
  suspend fun mustChangePassword(): Boolean = context.dataStore.data.map { it[mustChangeKey] == true }.first()

  suspend fun save(token: String, name: String?, role: String?, userId: String? = null, mustChangePassword: Boolean = false) {
    context.dataStore.edit {
      it[tokenKey] = token
      if (name != null) it[nameKey] = name
      if (role != null) it[roleKey] = role
      if (userId != null) it[userIdKey] = userId
      it[mustChangeKey] = mustChangePassword
    }
  }

  suspend fun setMustChangePassword(value: Boolean) {
    context.dataStore.edit { it[mustChangeKey] = value }
  }

  override suspend fun clear() {
    context.dataStore.edit { it.clear() }
  }
}
