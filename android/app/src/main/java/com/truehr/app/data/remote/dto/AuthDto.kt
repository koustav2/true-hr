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
data class LoginResponse(
  val token: String? = null,
  val user: UserDto? = null,
  // Two-step login: set when the server emailed a sign-in code instead.
  val otpRequired: Boolean = false,
  val email: String? = null,
)

@Serializable
data class LoginOtpRequest(val email: String, val otp: String)

@Serializable
data class ChangePasswordRequest(val newPassword: String)

@Serializable
data class ForgotPasswordRequest(val email: String)

@Serializable
data class ResetPasswordRequest(val email: String, val otp: String, val newPassword: String)

@Serializable
data class OkResponse(val ok: Boolean = false, val message: String? = null)

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
