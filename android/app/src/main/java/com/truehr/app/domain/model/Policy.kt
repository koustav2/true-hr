package com.truehr.app.domain.model

data class Policy(
  val id: Long,
  val title: String,
  val category: String?,
  val filename: String?,
  val mime: String?,
  val uploadedAt: String?,
)
