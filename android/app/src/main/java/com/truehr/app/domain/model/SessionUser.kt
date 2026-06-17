package com.truehr.app.domain.model

data class SessionUser(
  val email: String,
  val role: String,
  val mustChangePassword: Boolean,
)
