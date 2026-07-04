package com.truehr.app.domain.repository

import com.truehr.app.domain.model.KpiDetail
import com.truehr.app.domain.model.KpiRow
import com.truehr.app.domain.model.KraInput
import com.truehr.app.domain.model.PendingRating
import com.truehr.app.domain.model.PmsScoreInput
import com.truehr.app.domain.model.Settlement
import com.truehr.app.domain.model.TeamKpiRow

interface EssRepository {
  // Settlements
  suspend fun submitSettlement(nfaId: Long, amount: Double, remarks: String?): Settlement
  suspend fun settlementForNfa(nfaId: Long): Settlement
  suspend fun settlementsPending(): List<Settlement>
  suspend fun settlementAct(id: Long, action: String, remarks: String?): Settlement

  // PMS / KPI
  suspend fun kpiList(year: Int?): List<KpiRow>
  suspend fun kpiDetail(id: Long): KpiDetail
  suspend fun createKpi(year: Int, month: Int, copyPrevious: Boolean, kras: List<KraInput>?): KpiDetail
  suspend fun teamPending(): List<TeamKpiRow>
  suspend fun reviewKpi(id: Long, action: String): KpiDetail
  suspend fun submitPms(kpiId: Long, scores: List<PmsScoreInput>): KpiDetail
  suspend fun pmsPending(): List<PendingRating>
  suspend fun ratePms(submissionId: Long, pliRating: Int, pliPct: Double, remarks: String?): KpiDetail

  // Vendors & agreements
  suspend fun vendors(): List<com.truehr.app.domain.model.VendorRow>
  suspend fun createVendor(input: com.truehr.app.domain.model.VendorInput): com.truehr.app.domain.model.VendorRow
  suspend fun agreements(): List<com.truehr.app.domain.model.AgreementRow>
  suspend fun createAgreement(input: com.truehr.app.domain.model.AgreementInput): com.truehr.app.domain.model.AgreementRow
}
