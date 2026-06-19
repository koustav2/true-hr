package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class UserDto(
  val id: Long? = null,
  val email: String? = null,
  val role: String? = null,
  val mustChangePassword: Boolean = false,
)

@Serializable
data class LoginResponse(val token: String, val user: UserDto)

@Serializable
data class ChangePasswordRequest(val newPassword: String)

@Serializable
data class MeDto(
  val id: Long? = null,
  val email: String? = null,
  val role: String? = null,
  val must_change_password: Boolean = false,
  val first_name: String? = null,
  val last_name: String? = null,
  val employee_code: String? = null,
)
