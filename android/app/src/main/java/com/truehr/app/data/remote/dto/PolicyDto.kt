package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class PolicyDto(
  val id: Long? = null,
  val title: String? = null,
  val category: String? = null,
  val filename: String? = null,
  val mime: String? = null,
  val uploadedAt: String? = null,
  val available: Boolean = false,
  // v2 (E44): POLICY | FORMAT, version and effective date.
  val kind: String? = null,
  val version: String? = null,
  val effectiveDate: String? = null,
  val policyType: String? = null,
)
