package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.CreateKpiRequest
import com.truehr.app.data.remote.dto.KpiDetailDto
import com.truehr.app.data.remote.dto.KpiReviewRequest
import com.truehr.app.data.remote.dto.KraRequest
import com.truehr.app.data.remote.dto.NfaActRequest
import com.truehr.app.data.remote.dto.NfaApprovalDto
import com.truehr.app.data.remote.dto.PmsScoreRequest
import com.truehr.app.data.remote.dto.RatePmsRequest
import com.truehr.app.data.remote.dto.SettlementDto
import com.truehr.app.data.remote.dto.SubmitPmsRequest
import com.truehr.app.data.remote.dto.SubmitSettlementRequest
import com.truehr.app.domain.model.KpiDetail
import com.truehr.app.domain.model.KpiKra
import com.truehr.app.domain.model.KpiRow
import com.truehr.app.domain.model.KraInput
import com.truehr.app.domain.model.NfaApproval
import com.truehr.app.domain.model.NfaChainStage
import com.truehr.app.domain.model.PendingRating
import com.truehr.app.domain.model.PmsKraScore
import com.truehr.app.domain.model.PmsLevelRating
import com.truehr.app.domain.model.PmsScoreInput
import com.truehr.app.domain.model.PmsSubmission
import com.truehr.app.domain.model.Settlement
import com.truehr.app.domain.model.TeamKpiRow
import com.truehr.app.domain.repository.EssRepository
import javax.inject.Inject

class EssRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : EssRepository {

  // ---- Settlements ----
  override suspend fun submitSettlement(nfaId: Long, amount: Double, remarks: String?): Settlement =
    api.settlementSubmit(nfaId, SubmitSettlementRequest(amount = amount, remarks = remarks)).toModel()

  override suspend fun settlementForNfa(nfaId: Long): Settlement = api.settlementForNfa(nfaId).toModel()

  override suspend fun settlementsPending(): List<Settlement> = api.settlementsPending().map { it.toModel() }

  override suspend fun settlementAct(id: Long, action: String, remarks: String?): Settlement =
    api.settlementAct(id, NfaActRequest(action = action, remarks = remarks)).toModel()

  // ---- PMS / KPI ----
  override suspend fun kpiList(year: Int?): List<KpiRow> = api.kpiList(year).map {
    KpiRow(it.id, it.year, it.month, it.kpiStatus, it.pmsStatus, it.selfRating, it.finalGrade, it.finalPliPct)
  }

  override suspend fun kpiDetail(id: Long): KpiDetail = api.kpiDetail(id).toModel()

  override suspend fun createKpi(year: Int, month: Int, copyPrevious: Boolean, kras: List<KraInput>?): KpiDetail =
    api.kpiCreate(
      CreateKpiRequest(
        year = year, month = month,
        copyPrevious = if (copyPrevious) true else null,
        kras = kras?.map { KraRequest(it.description, it.weightage) },
      ),
    ).toModel()

  override suspend fun teamPending(): List<TeamKpiRow> = api.kpiTeamPending().map {
    TeamKpiRow(it.id, it.year, it.month, it.status, it.employee?.name, it.employee?.designation)
  }

  override suspend fun reviewKpi(id: Long, action: String): KpiDetail =
    api.kpiReview(id, KpiReviewRequest(action)).toModel()

  override suspend fun submitPms(kpiId: Long, scores: List<PmsScoreInput>): KpiDetail =
    api.pmsSubmit(
      kpiId,
      SubmitPmsRequest(scores.map {
        PmsScoreRequest(kraId = it.kraId, mtdTarget = it.mtdTarget, mtdAchieved = it.mtdAchieved, selfRating = it.selfRating, selfRemarks = it.selfRemarks)
      }),
    ).toModel()

  override suspend fun pmsPending(): List<PendingRating> = api.pmsPending().map {
    PendingRating(it.submissionId, it.stage?.roleKey, it.year, it.month, it.selfRating, it.employee?.name)
  }

  override suspend fun ratePms(submissionId: Long, pliRating: Int, pliPct: Double, remarks: String?): KpiDetail =
    api.pmsRate(submissionId, RatePmsRequest(pliRating = pliRating, pliPct = pliPct, remarks = remarks)).toModel()

  // ---- Vendors & agreements ----
  override suspend fun vendors(): List<com.truehr.app.domain.model.VendorRow> = api.vendors().map {
    com.truehr.app.domain.model.VendorRow(it.id, it.companyName.orEmpty(), it.natureOfBusiness, it.typeOfCompany, it.pan, it.gst, it.status)
  }

  override suspend fun createVendor(input: com.truehr.app.domain.model.VendorInput): com.truehr.app.domain.model.VendorRow =
    api.vendorCreate(
      com.truehr.app.data.remote.dto.CreateVendorRequest(
        companyName = input.companyName, natureOfBusiness = input.natureOfBusiness, typeOfCompany = input.typeOfCompany,
        pan = input.pan, gst = input.gst, esic = input.esic, pf = input.pf, msmed = input.msmed, nsicSsi = input.nsicSsi,
        contactPerson = input.contactPerson, contactPhone = input.contactPhone,
      ),
    ).let { com.truehr.app.domain.model.VendorRow(it.id, it.companyName.orEmpty(), it.natureOfBusiness, it.typeOfCompany, it.pan, it.gst, it.status) }

  override suspend fun agreements(): List<com.truehr.app.domain.model.AgreementRow> = api.agreements().map {
    com.truehr.app.domain.model.AgreementRow(it.id, it.agreementType.orEmpty(), it.project?.name, it.location?.name, it.client?.name,
      it.startDate?.take(10), it.endDate?.take(10), it.status)
  }

  override suspend fun createAgreement(input: com.truehr.app.domain.model.AgreementInput): com.truehr.app.domain.model.AgreementRow =
    api.agreementCreate(
      com.truehr.app.data.remote.dto.CreateAgreementRequest(
        projectId = input.projectId, locationId = input.locationId, clientId = input.clientId,
        agreementType = input.agreementType, details = input.details, startDate = input.startDate, endDate = input.endDate,
      ),
    ).let { com.truehr.app.domain.model.AgreementRow(it.id, it.agreementType.orEmpty(), it.project?.name, it.location?.name, it.client?.name,
      it.startDate?.take(10), it.endDate?.take(10), it.status) }
}

private fun NfaApprovalDto.toApproval() = NfaApproval(
  status = status.orEmpty(),
  currentStageSeq = currentStageSeq,
  chain = chain.map {
    NfaChainStage(
      seq = it.seq,
      roleKey = it.roleKey.orEmpty(),
      status = it.status.orEmpty(),
      remarks = it.remarks,
      actedAt = it.actedAt?.take(10),
      approverName = it.approver?.name,
    )
  },
)

private fun SettlementDto.toModel() = Settlement(
  id = id,
  nfaId = nfaId,
  nfaCode = nfaCode,
  amount = amount ?: 0.0,
  remarks = remarks,
  status = status,
  raisedAt = raisedAt?.take(10),
  nfaGrandTotal = nfaGrandTotal,
  settlementDueDate = settlementDueDate?.take(10),
  approval = approval?.toApproval(),
  pendingStageRole = pendingStage?.roleKey,
)

private fun KpiDetailDto.toModel() = KpiDetail(
  id = id,
  employeeName = employee?.name,
  year = year,
  month = month,
  status = status,
  kras = kras.map { KpiKra(it.id, it.seq, it.description, it.weightage) },
  pms = pms?.let { p ->
    PmsSubmission(
      id = p.id,
      status = p.status,
      selfRating = p.selfRating,
      finalGrade = p.finalGrade,
      finalPliPct = p.finalPliPct,
      approval = p.approval?.toApproval(),
      scores = p.scores.map { PmsKraScore(it.kraId, it.mtdTarget, it.mtdAchieved, it.selfRating, it.selfRemarks, it.mgrRating, it.mgrRemarks) },
      levelRatings = p.levelRatings.map { PmsLevelRating(it.roleKey, it.pliRating, it.pliPct, it.remarks, it.ratedBy) },
    )
  },
)
