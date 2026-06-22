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
)
