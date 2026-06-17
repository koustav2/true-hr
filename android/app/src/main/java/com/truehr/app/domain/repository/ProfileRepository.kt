package com.truehr.app.domain.repository

import com.truehr.app.domain.model.Profile

interface ProfileRepository {
  suspend fun getProfile(): Profile
}
