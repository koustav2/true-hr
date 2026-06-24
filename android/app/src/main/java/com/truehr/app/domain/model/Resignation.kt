package com.truehr.app.domain.model

data class Approver(val employeeCode: String?, val name: String?, val email: String?)

data class ResignationEmployee(
  val employeeCode: String?,
  val name: String?,
  val designation: String?,
  val vertical: String?,
  val location: String?,
  val noticePeriodDays: Int,
)

data class Resignation(
  val id: Long,
  val employeeCode: String?,
  val name: String?,
  val designation: String?,
  val department: String?,
  val location: String?,
  val resignationDate: String?,
  val lastWorkingDate: String?,
  val noticePeriodDays: Int,
  val reason: String?,
  val status: String?,
  val reviewNote: String?,
  val appliedAt: String?,
  val reviewedAt: String?,
)

data class ResignationContext(
  val employee: ResignationEmployee?,
  val approvers: List<Approver>,
  val current: Resignation?,
)
