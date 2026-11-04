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

// ---- v2 /me/full-profile (E53): the whole record, read-only, sensitive fields masked ----

@Serializable
data class AddressDto(
  val type: String? = null,
  val line1: String? = null,
  val line2: String? = null,
  val city: String? = null,
  val district: String? = null,
  val state: String? = null,
  val pincode: String? = null,
  val country: String? = null,
)

@Serializable
data class FullBankDto(
  val accountHolder: String? = null,
  val bankName: String? = null,
  val branch: String? = null,
  val ifsc: String? = null,
  val accountNumberMasked: String? = null,
)

@Serializable
data class FullStatutoryDto(
  val panMasked: String? = null,
  val aadhaarMasked: String? = null,
  val uan: String? = null,
  val pfNumber: String? = null,
  val esiNumber: String? = null,
)

@Serializable
data class FullProfileDto(
  val employeeCode: String? = null,
  val firstName: String? = null,
  val lastName: String? = null,
  val fullName: String? = null,
  val designation: String? = null,
  val department: String? = null,
  val subDepartment: String? = null,
  val company: String? = null,
  val branch: String? = null,
  val location: String? = null,
  val employmentType: String? = null,
  val dateOfJoining: String? = null,
  val dob: String? = null,
  val gender: String? = null,
  val phone: String? = null,
  val personalEmail: String? = null,
  val officialEmail: String? = null,
  val reportingManager: String? = null,
  val reportingManagerCode: String? = null,
  val functionalManager: String? = null,
  val operationalManager: String? = null,
  val bloodGroup: String? = null,
  val maritalStatus: String? = null,
  val emergencyContact: kotlinx.serialization.json.JsonElement? = null,
  val addresses: List<AddressDto> = emptyList(),
  val bank: FullBankDto = FullBankDto(),
  val statutory: FullStatutoryDto = FullStatutoryDto(),
)

// ---- Request a change (E57-E61) ----

@Serializable
data class ChangeRequestDto(
  val id: Long,
  val kind: String,
  val payload: Map<String, kotlinx.serialization.json.JsonElement> = emptyMap(),
  val status: String? = null,
  val submittedAt: String? = null,
  val reviewedAt: String? = null,
  val reviewNote: String? = null,
)

@Serializable
data class ChangeRequestBody(val kind: String, val payload: Map<String, String>)

@Serializable
data class ChangeRequestEdit(val payload: Map<String, String>)
