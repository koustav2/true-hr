package com.truehr.app.data.local

import android.content.Context
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

@Singleton
class TokenStore @Inject constructor(@ApplicationContext private val context: Context) {
  private val tokenKey = stringPreferencesKey("token")
  private val nameKey = stringPreferencesKey("name")
  private val roleKey = stringPreferencesKey("role")

  val token: Flow<String?> = context.dataStore.data.map { it[tokenKey] }

  suspend fun current(): String? = context.dataStore.data.map { it[tokenKey] }.first()

  suspend fun save(token: String, name: String?, role: String?) {
    context.dataStore.edit {
      it[tokenKey] = token
      if (name != null) it[nameKey] = name
      if (role != null) it[roleKey] = role
    }
  }

  suspend fun clear() {
    context.dataStore.edit { it.clear() }
  }
}
