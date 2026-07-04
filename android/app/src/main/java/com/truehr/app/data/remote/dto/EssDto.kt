package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

// ---- NFA settlements ----

@Serializable
data class SettlementDto(
  val id: Long,
  val nfaId: Long? = null,
  val nfaCode: String? = null,
  val amount: Double? = null,
  val remarks: String? = null,
  val status: String,
  val raisedAt: String? = null,
  val closedAt: String? = null,
  val nfaGrandTotal: Double? = null,
  val settlementDueDate: String? = null,
  val approval: NfaApprovalDto? = null,
  val pendingStage: NfaPendingStageDto? = null,
)

@Serializable
data class SubmitSettlementRequest(
  val amount: Double,
  val remarks: String? = null,
)

// ---- PMS / KPI ----

@Serializable
data class KpiRowDto(
  val id: Long,
  val year: Int,
  val month: Int,
  val kpiStatus: String,
  val pmsStatus: String,
  val selfRating: Double? = null,
  val finalGrade: String? = null,
  val finalPliPct: Double? = null,
  val submittedAt: String? = null,
  val approvedAt: String? = null,
)

@Serializable
data class KpiKraDto(
  val id: Long,
  val seq: Int,
  val description: String,
  val weightage: Double,
)

@Serializable
data class PmsLevelRatingDto(
  val roleKey: String,
  val pliRating: Int? = null,
  val pliPct: Double? = null,
  val remarks: String? = null,
  val ratedBy: String? = null,
)

@Serializable
data class PmsKraScoreDto(
  val kraId: Long,
  val mtdTarget: String? = null,
  val mtdAchieved: String? = null,
  val selfRating: Double? = null,
  val selfRemarks: String? = null,
  val mgrRating: Double? = null,
  val mgrRemarks: String? = null,
)

@Serializable
data class PmsSubmissionDto(
  val id: Long,
  val status: String,
  val selfRating: Double? = null,
  val finalGrade: String? = null,
  val finalPliPct: Double? = null,
  val approval: NfaApprovalDto? = null,
  val scores: List<PmsKraScoreDto> = emptyList(),
  val levelRatings: List<PmsLevelRatingDto> = emptyList(),
)

@Serializable
data class KpiEmployeeDto(
  val id: Long? = null,
  val employeeCode: String? = null,
  val name: String? = null,
  val designation: String? = null,
)

@Serializable
data class KpiDetailDto(
  val id: Long,
  val employee: KpiEmployeeDto? = null,
  val year: Int,
  val month: Int,
  val status: String,
  val kras: List<KpiKraDto> = emptyList(),
  val pms: PmsSubmissionDto? = null,
)

@Serializable
data class TeamKpiRowDto(
  val id: Long,
  val year: Int,
  val month: Int,
  val status: String,
  val submittedAt: String? = null,
  val employee: KpiEmployeeDto? = null,
)

@Serializable
data class PendingRatingDto(
  val submissionId: Long,
  val stage: NfaPendingStageDto? = null,
  val year: Int? = null,
  val month: Int? = null,
  val selfRating: Double? = null,
  val employee: KpiEmployeeDto? = null,
)

@Serializable
data class KraRequest(
  val description: String,
  val weightage: Double,
)

@Serializable
data class CreateKpiRequest(
  val year: Int,
  val month: Int,
  val copyPrevious: Boolean? = null,
  val kras: List<KraRequest>? = null,
)

@Serializable
data class KpiReviewRequest(val action: String)

@Serializable
data class PmsScoreRequest(
  val kraId: Long,
  val mtdTarget: String? = null,
  val mtdAchieved: String? = null,
  val selfRating: Double,
  val selfRemarks: String? = null,
)

@Serializable
data class SubmitPmsRequest(val scores: List<PmsScoreRequest>)

@Serializable
data class RatePmsRequest(
  val pliRating: Int,
  val pliPct: Double,
  val remarks: String? = null,
)

// ---- Vendors & agreements ----

@Serializable
data class VendorDto(
  val id: Long,
  val companyName: String? = null,
  val natureOfBusiness: String? = null,
  val businessCategory: String? = null,
  val typeOfCompany: String? = null,
  val pan: String? = null,
  val gst: String? = null,
  val esic: String? = null,
  val pf: String? = null,
  val msmed: String? = null,
  val nsicSsi: String? = null,
  val contactPerson: String? = null,
  val contactPhone: String? = null,
  val contactEmail: String? = null,
  val status: String,
  val createdAt: String? = null,
)

@Serializable
data class CreateVendorRequest(
  val companyName: String,
  val natureOfBusiness: String? = null,
  val businessCategory: String? = null,
  val headOfficeAddress: String? = null,
  val typeOfCompany: String? = null,
  val pan: String? = null,
  val gst: String? = null,
  val esic: String? = null,
  val pf: String? = null,
  val msmed: String? = null,
  val nsicSsi: String? = null,
  val contactPerson: String? = null,
  val contactPhone: String? = null,
  val contactEmail: String? = null,
)

@Serializable
data class AgreementDto(
  val id: Long,
  val status: String,
  val project: NfaOptionDto? = null,
  val location: NfaOptionDto? = null,
  val client: NfaOptionDto? = null,
  val agreementType: String? = null,
  val details: String? = null,
  val startDate: String? = null,
  val endDate: String? = null,
  val createdAt: String? = null,
)

@Serializable
data class CreateAgreementRequest(
  val projectId: Long? = null,
  val locationId: Long? = null,
  val clientId: Long? = null,
  val agreementType: String,
  val details: String? = null,
  val startDate: String,
  val endDate: String,
)
