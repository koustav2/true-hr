package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.CreateNfaRequest
import com.truehr.app.data.remote.dto.NfaActRequest
import com.truehr.app.data.remote.dto.NfaLineRequest
import com.truehr.app.data.remote.dto.NfaResubmitRequest
import com.truehr.app.domain.model.NfaApproval
import com.truehr.app.domain.model.NfaApprover
import com.truehr.app.domain.model.NfaChainStage
import com.truehr.app.domain.model.NfaClientVendor
import com.truehr.app.domain.model.NfaCreateInput
import com.truehr.app.domain.model.NfaDetail
import com.truehr.app.domain.model.NfaExpenseCategory
import com.truehr.app.domain.model.NfaExpenseHeader
import com.truehr.app.domain.model.NfaExpenseSubheader
import com.truehr.app.domain.model.NfaLedger
import com.truehr.app.domain.model.NfaLine
import com.truehr.app.domain.model.NfaLocation
import com.truehr.app.domain.model.NfaMasters
import com.truehr.app.domain.model.NfaOption
import com.truehr.app.domain.model.NfaPreviewStage
import com.truehr.app.domain.model.NfaProject
import com.truehr.app.domain.model.NfaRow
import com.truehr.app.domain.model.NfaTotals
import com.truehr.app.domain.repository.NfaRepository
import javax.inject.Inject

class NfaRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : NfaRepository {

  override suspend fun masters(): NfaMasters = api.nfaMasters().let { m ->
    NfaMasters(
      businessOperations = m.businessOperations.map { NfaOption(it.id, it.name) },
      groupCompanies = m.groupCompanies.map { NfaOption(it.id, it.name) },
      costZones = m.costZones.map { NfaOption(it.id, it.name) },
      projects = m.projects.map { NfaProject(it.id, it.name, it.businessOperationId, it.groupCompanyId) },
      locations = m.locations.map { NfaLocation(it.id, it.name, it.kind) },
      clientsVendors = m.clientsVendors.map { NfaClientVendor(it.id, it.name, it.type) },
      expenseCategories = m.expenseCategories.map { NfaExpenseCategory(it.id, it.name, it.businessOperationId) },
      expenseHeaders = m.expenseHeaders.map { NfaExpenseHeader(it.id, it.name, it.categoryId) },
      expenseSubheaders = m.expenseSubheaders.map { NfaExpenseSubheader(it.id, it.name, it.headerId) },
    )
  }

  override suspend fun approvalPreview(projectId: Long?, expenseCategoryId: Long?, zoneId: Long?): List<NfaPreviewStage> =
    api.nfaApprovalPreview(projectId = projectId, expenseCategoryId = expenseCategoryId, zoneId = zoneId).map {
      NfaPreviewStage(
        seq = it.seq,
        roleKey = it.roleKey.orEmpty(),
        approver = it.approver?.let { a -> NfaApprover(a.id, a.employeeCode, a.name, a.email) },
        willBypass = it.willBypass,
      )
    }

  override suspend fun create(input: NfaCreateInput): NfaDetail = api.nfaCreate(
    CreateNfaRequest(
      raiseFor = input.raiseFor,
      businessOperationId = input.businessOperationId,
      groupCompanyId = input.groupCompanyId,
      projectId = input.projectId,
      expenseCategoryId = input.expenseCategoryId,
      zoneId = input.zoneId,
      locationId = input.locationId,
      clientVendorId = input.clientVendorId,
      expenseMonth = input.expenseMonth,
      paymentType = input.paymentType,
      billableType = input.billableType,
      billedState = input.billedState,
      invoiceDate = input.invoiceDate,
      invoiceAmount = input.invoiceAmount,
      expectedPaymentDate = input.expectedPaymentDate,
      settlementDueDate = input.settlementDueDate,
      purpose = input.purpose,
      description = input.description,
      priority = input.priority,
      lines = input.lines.map { NfaLineRequest(headerId = it.headerId, subheaderId = it.subheaderId, nfaAmount = it.nfaAmount, logisticAmount = it.logisticAmount) },
    ),
  ).toModel()

  override suspend fun list(year: Int?, month: Int?, status: String?): List<NfaRow> =
    api.nfaList(year = year, month = month, status = status).map { it.toModel() }

  override suspend fun pending(): List<NfaRow> = api.nfaPending().map { it.toModel() }

  override suspend fun detail(id: Long): NfaDetail = api.nfaDetail(id).toModel()

  override suspend fun act(id: Long, action: String, remarks: String?): NfaDetail =
    api.nfaAct(id, NfaActRequest(action = action, remarks = remarks)).toModel()

  override suspend fun resubmit(id: Long, remarks: String): NfaDetail =
    api.nfaResubmit(id, NfaResubmitRequest(remarks = remarks)).toModel()

  override suspend fun ledger(): NfaLedger = api.nfaLedger().let {
    NfaLedger(
      financialYear = it.financialYear.orEmpty(),
      totalRaised = it.totalRaised,
      paymentsReleased = it.paymentsReleased,
      settled = it.settled,
      amountReceived = it.amountReceived,
      settlementAmount = it.settlementAmount,
      balanceToSettle = it.balanceToSettle,
    )
  }
}

private fun com.truehr.app.data.remote.dto.NfaRowDto.toModel() = NfaRow(
  id = id,
  nfaCode = nfaCode.orEmpty(),
  employeeCode = employee?.employeeCode.orEmpty(),
  employeeName = employee?.name.orEmpty(),
  projectName = project?.name.orEmpty(),
  expenseCategoryName = expenseCategory?.name.orEmpty(),
  paymentType = paymentType.orEmpty(),
  billableType = billableType.orEmpty(),
  totals = NfaTotals(totals?.nfa ?: 0.0, totals?.logistic ?: 0.0, totals?.grand ?: 0.0),
  status = status.orEmpty(),
  statusLabel = statusLabel?.takeIf { it.isNotBlank() } ?: status.orEmpty(),
  createdAt = createdAt?.take(10),
  settlementDueDate = settlementDueDate?.take(10),
  priority = priority.orEmpty(),
  pendingStageSeq = pendingStage?.seq,
  pendingStageRole = pendingStage?.roleKey,
)

private fun com.truehr.app.data.remote.dto.NfaDetailDto.toModel() = NfaDetail(
  id = id,
  nfaCode = nfaCode.orEmpty(),
  employeeCode = employee?.employeeCode.orEmpty(),
  employeeName = employee?.name.orEmpty(),
  raiseFor = raiseFor.orEmpty(),
  businessOperation = businessOperation?.name.orEmpty(),
  groupCompany = groupCompany?.name.orEmpty(),
  project = project?.name.orEmpty(),
  expenseCategory = expenseCategory?.name.orEmpty(),
  zone = zone?.name.orEmpty(),
  location = location?.name.orEmpty(),
  clientVendor = clientVendor?.name,
  expenseMonth = expenseMonth,
  paymentType = paymentType.orEmpty(),
  billableType = billableType.orEmpty(),
  billedState = billedState,
  invoiceDate = invoiceDate?.take(10),
  invoiceAmount = invoiceAmount,
  expectedPaymentDate = expectedPaymentDate?.take(10),
  settlementDueDate = settlementDueDate?.take(10),
  purpose = purpose,
  description = description,
  priority = priority.orEmpty(),
  status = status.orEmpty(),
  statusLabel = statusLabel?.takeIf { it.isNotBlank() } ?: status.orEmpty(),
  settlementStatus = settlementStatus,
  createdAt = createdAt?.take(10),
  totals = NfaTotals(totals?.nfa ?: 0.0, totals?.logistic ?: 0.0, totals?.grand ?: 0.0),
  lines = lines.map {
    NfaLine(
      seq = it.seq,
      headerName = it.header?.name.orEmpty(),
      subheaderName = it.subheader?.name,
      nfaAmount = it.nfaAmount,
      logisticAmount = it.logisticAmount,
      totalAmount = it.totalAmount,
    )
  },
  approval = approval?.let { a ->
    NfaApproval(
      status = a.status.orEmpty(),
      currentStageSeq = a.currentStageSeq,
      chain = a.chain.map {
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
  },
)
