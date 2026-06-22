package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

@Serializable
data class PayslipRowDto(
  val id: Long? = null,
  val year: Int,
  val month: Int,
  val monthName: String? = null,
  val employeeCode: String? = null,
  val available: Boolean = false,
)

@Serializable
data class PayLineDto(
  val label: String,
  val amount: Double = 0.0,
)

@Serializable
data class PayslipMetaDto(
  val name: String? = null,
  val employeeCode: String? = null,
  val designation: String? = null,
  val grade: String? = null,
  val bankName: String? = null,
  val accountNumber: String? = null,
  val pan: String? = null,
  val uan: String? = null,
  val location: String? = null,
  val state: String? = null,
)

@Serializable
data class PayslipDto(
  val id: Long,
  val year: Int,
  val month: Int,
  val monthName: String? = null,
  val status: String? = null,
  val daysInMonth: Int = 0,
  val daysPaid: Double = 0.0,
  val arrears: Double = 0.0,
  val grossEarnings: Double = 0.0,
  val totalDeductions: Double = 0.0,
  val netPay: Double = 0.0,
  val generatedAt: String? = null,
  val publishedAt: String? = null,
  val earnings: List<PayLineDto> = emptyList(),
  val deductions: List<PayLineDto> = emptyList(),
  val meta: PayslipMetaDto? = null,
)
