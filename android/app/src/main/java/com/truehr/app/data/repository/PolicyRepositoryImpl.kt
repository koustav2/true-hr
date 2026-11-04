package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.domain.model.Policy
import com.truehr.app.domain.repository.PolicyRepository
import javax.inject.Inject

class PolicyRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : PolicyRepository {
  override suspend fun list(): List<Policy> = api.policies().map {
    Policy(id = it.id, title = it.title.orEmpty(), category = it.category ?: it.policyType, filename = it.filename, mime = it.mime, uploadedAt = it.uploadedAt, available = it.available,
      kind = it.kind, version = it.version, effectiveDate = it.effectiveDate)
  }

  // A3: read the streamed file on the IO dispatcher.
  override suspend fun fileBytes(id: Long): ByteArray =
    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { api.policyFile(id).use { it.bytes() } }
}
