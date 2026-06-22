package com.truehr.app.domain.repository

import com.truehr.app.domain.model.Policy

interface PolicyRepository {
  suspend fun list(): List<Policy>
  suspend fun fileBytes(id: Long): ByteArray
}
