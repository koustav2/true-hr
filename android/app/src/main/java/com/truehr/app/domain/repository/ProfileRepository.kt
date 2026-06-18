package com.truehr.app.domain.repository

import com.truehr.app.domain.model.DirectoryEntry
import com.truehr.app.domain.model.Profile
import com.truehr.app.domain.model.TeamMate

interface ProfileRepository {
  suspend fun getProfile(): Profile
  suspend fun myTeam(): List<TeamMate>
  suspend fun directory(): List<DirectoryEntry>
}
