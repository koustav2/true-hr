package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.domain.model.Policy
import com.truehr.app.domain.repository.PolicyRepository
import javax.inject.Inject

class PolicyRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : PolicyRepository {
  override suspend fun list(): List<Policy> = api.policies().map {
    Policy(id = it.id, title = it.title.orEmpty(), category = it.category, filename = it.filename, mime = it.mime, uploadedAt = it.uploadedAt, available = it.available)
  }

  override suspend fun fileBytes(id: Long): ByteArray = api.policyFile(id).bytes()
}
