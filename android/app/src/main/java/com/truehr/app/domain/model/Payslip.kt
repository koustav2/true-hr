package com.truehr.app.domain.model

data class PayslipRow(
  val id: Long?,
  val year: Int,
  val month: Int,
  val monthName: String,
  val employeeCode: String?,
  val available: Boolean,
)

data class PayLine(val label: String, val amount: Double)

data class PayslipMeta(
  val name: String?,
  val employeeCode: String?,
  val designation: String?,
  val grade: String?,
  val bankName: String?,
  val accountNumber: String?,
  val pan: String?,
  val uan: String?,
  val location: String?,
  val state: String?,
)

data class Payslip(
  val id: Long,
  val year: Int,
  val month: Int,
  val monthName: String,
  val daysInMonth: Int,
  val daysPaid: Double,
  val arrears: Double,
  val grossEarnings: Double,
  val totalDeductions: Double,
  val netPay: Double,
  val earnings: List<PayLine>,
  val deductions: List<PayLine>,
  val meta: PayslipMeta?,
)
