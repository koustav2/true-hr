package com.truehr.app.domain.model

// ---- NFA settlements ----

data class Settlement(
  val id: Long,
  val nfaId: Long?,
  val nfaCode: String?,
  val amount: Double,
  val remarks: String?,
  val status: String,          // IN_PROGRESS | CLOSED | REJECTED | AUTO_REJECTED
  val raisedAt: String?,
  val nfaGrandTotal: Double?,
  val settlementDueDate: String?,
  val approval: NfaApproval?,
  val pendingStageRole: String?,
)

// ---- PMS / KPI ----

data class KpiRow(
  val id: Long,
  val year: Int,
  val month: Int,
  val kpiStatus: String,       // RM_PENDING | LOCKED | DISCUSS
  val pmsStatus: String,       // NOT_SUBMITTED | APPROVAL_PENDING | FUNCTIONAL_APPROVED
  val selfRating: Double?,
  val finalGrade: String?,     // OAT | SAT | AT | BT | SBT
  val finalPliPct: Double?,
)

data class KpiKra(
  val id: Long,
  val seq: Int,
  val description: String,
  val weightage: Double,
)

data class PmsLevelRating(
  val roleKey: String,
  val pliRating: Int?,
  val pliPct: Double?,
  val remarks: String?,
  val ratedBy: String?,
)

data class PmsKraScore(
  val kraId: Long,
  val mtdTarget: String?,
  val mtdAchieved: String?,
  val selfRating: Double?,
  val selfRemarks: String?,
  val mgrRating: Double?,
  val mgrRemarks: String?,
)

data class PmsSubmission(
  val id: Long,
  val status: String,
  val selfRating: Double?,
  val finalGrade: String?,
  val finalPliPct: Double?,
  val approval: NfaApproval?,
  val scores: List<PmsKraScore>,
  val levelRatings: List<PmsLevelRating>,
)

data class KpiDetail(
  val id: Long,
  val employeeName: String?,
  val year: Int,
  val month: Int,
  val status: String,
  val kras: List<KpiKra>,
  val pms: PmsSubmission?,
)

data class TeamKpiRow(
  val id: Long,
  val year: Int,
  val month: Int,
  val status: String,
  val employeeName: String?,
  val designation: String?,
)

data class PendingRating(
  val submissionId: Long,
  val stageRole: String?,
  val year: Int?,
  val month: Int?,
  val selfRating: Double?,
  val employeeName: String?,
)

data class KraInput(val description: String, val weightage: Double)

data class VendorRow(
  val id: Long,
  val companyName: String,
  val natureOfBusiness: String?,
  val typeOfCompany: String?,
  val pan: String?,
  val gst: String?,
  val status: String,
)

data class VendorInput(
  val companyName: String,
  val natureOfBusiness: String?,
  val typeOfCompany: String?,
  val pan: String?,
  val gst: String?,
  val esic: String?,
  val pf: String?,
  val msmed: String?,
  val nsicSsi: String?,
  val contactPerson: String?,
  val contactPhone: String?,
)

data class AgreementRow(
  val id: Long,
  val agreementType: String,
  val projectName: String?,
  val locationName: String?,
  val clientName: String?,
  val startDate: String?,
  val endDate: String?,
  val status: String,
)

data class AgreementInput(
  val projectId: Long?,
  val locationId: Long?,
  val clientId: Long?,
  val agreementType: String,
  val details: String?,
  val startDate: String,
  val endDate: String,
)

data class PmsScoreInput(
  val kraId: Long,
  val mtdTarget: String?,
  val mtdAchieved: String?,
  val selfRating: Double,
  val selfRemarks: String?,
)
