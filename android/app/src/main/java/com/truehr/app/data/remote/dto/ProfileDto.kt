package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class BankDto(
  val name: String? = null,
  val branch: String? = null,
  val ifsc: String? = null,
  val accountNumber: String? = null,
)

@Serializable
data class StatutoryDto(
  val pan: String? = null,
  val aadhaar: String? = null,
  val uan: String? = null,
  val pfNumber: String? = null,
  val esiNumber: String? = null,
)

@Serializable
data class ProfileDto(
  val employeeCode: String? = null,
  val firstName: String? = null,
  val lastName: String? = null,
  val isManager: Boolean = false,
  val designation: String? = null,
  val department: String? = null,
  val company: String? = null,
  val dob: String? = null,
  val gender: String? = null,
  val phone: String? = null,
  val personalEmail: String? = null,
  val officialEmail: String? = null,
  val dateOfJoining: String? = null,
  val location: String? = null,
  val employmentType: String? = null,
  val reportingManager: String? = null,
  val functionalManager: String? = null,
  val address: String? = null,
  val permanentAddress: String? = null,
  val bank: BankDto = BankDto(),
  val statutory: StatutoryDto = StatutoryDto(),
)
