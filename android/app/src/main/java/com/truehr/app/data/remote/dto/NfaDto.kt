package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

// ---- Masters (GET /meta/nfa-masters) ----

@Serializable
data class NfaOptionDto(
  val id: Long,
  val name: String,
)

@Serializable
data class NfaProjectDto(
  val id: Long,
  val name: String,
  val businessOperationId: Long? = null,
  val groupCompanyId: Long? = null,
)

@Serializable
data class NfaLocationDto(
  val id: Long,
  val name: String,
  val kind: String? = null,
)

@Serializable
data class NfaClientVendorDto(
  val id: Long,
  val name: String,
  val type: String? = null,
)

@Serializable
data class NfaExpenseCategoryDto(
  val id: Long,
  val name: String,
  val businessOperationId: Long? = null,
)

@Serializable
data class NfaExpenseHeaderDto(
  val id: Long,
  val name: String,
  val categoryId: Long? = null,
)

@Serializable
data class NfaExpenseSubheaderDto(
  val id: Long,
  val name: String,
  val headerId: Long? = null,
)

@Serializable
data class NfaMastersDto(
  val businessOperations: List<NfaOptionDto> = emptyList(),
  val groupCompanies: List<NfaOptionDto> = emptyList(),
  val costZones: List<NfaOptionDto> = emptyList(),
  val projects: List<NfaProjectDto> = emptyList(),
  val locations: List<NfaLocationDto> = emptyList(),
  val clientsVendors: List<NfaClientVendorDto> = emptyList(),
  val expenseCategories: List<NfaExpenseCategoryDto> = emptyList(),
  val expenseHeaders: List<NfaExpenseHeaderDto> = emptyList(),
  val expenseSubheaders: List<NfaExpenseSubheaderDto> = emptyList(),
)

// ---- Approval preview (GET /approvals/preview) ----

@Serializable
data class NfaApproverDto(
  val id: Long? = null,
  val employeeCode: String? = null,
  val name: String? = null,
  val email: String? = null,
)

@Serializable
data class NfaPreviewStageDto(
  val seq: Int = 0,
  val roleKey: String? = null,
  val approver: NfaApproverDto? = null,
  val willBypass: Boolean = false,
)

// ---- Create (POST /nfa) ----

@Serializable
data class NfaLineRequest(
  val headerId: Long,
  val subheaderId: Long? = null,
  val nfaAmount: Double,
  val logisticAmount: Double,
)

@Serializable
data class CreateNfaRequest(
  val raiseFor: String,
  val businessOperationId: Long,
  val groupCompanyId: Long,
  val projectId: Long,
  val expenseCategoryId: Long,
  val zoneId: Long,
  val locationId: Long,
  val clientVendorId: Long? = null,
  val expenseMonth: Int,
  val paymentType: String,
  val billableType: String,
  val billedState: String? = null,
  val invoiceDate: String? = null,
  val invoiceAmount: Double? = null,
  val expectedPaymentDate: String? = null,
  val settlementDueDate: String,
  val purpose: String,
  val description: String? = null,
  val priority: String,
  val lines: List<NfaLineRequest>,
)

// ---- List / pending rows ----

@Serializable
data class NfaEmployeeDto(
  val id: Long? = null,
  val employeeCode: String? = null,
  val name: String? = null,
)

@Serializable
data class NfaTotalsDto(
  val nfa: Double = 0.0,
  val logistic: Double = 0.0,
  val grand: Double = 0.0,
)

@Serializable
data class NfaPendingStageDto(
  val seq: Int = 0,
  val roleKey: String? = null,
)

@Serializable
data class NfaRowDto(
  val id: Long,
  val nfaCode: String? = null,
  val employee: NfaEmployeeDto? = null,
  val project: NfaOptionDto? = null,
  val expenseCategory: NfaOptionDto? = null,
  val paymentType: String? = null,
  val billableType: String? = null,
  val totals: NfaTotalsDto? = null,
  val status: String? = null,
  val statusLabel: String? = null,
  val settlementStatus: String? = null,
  val createdAt: String? = null,
  val settlementDueDate: String? = null,
  val priority: String? = null,
  val pendingStage: NfaPendingStageDto? = null,
  val instanceId: Long? = null,
)

// ---- Detail (GET /nfa/:id) ----

@Serializable
data class NfaLineRefDto(
  val id: Long? = null,
  val name: String? = null,
)

@Serializable
data class NfaLineDto(
  val seq: Int = 0,
  val header: NfaLineRefDto? = null,
  val subheader: NfaLineRefDto? = null,
  val nfaAmount: Double = 0.0,
  val logisticAmount: Double = 0.0,
  val totalAmount: Double = 0.0,
)

@Serializable
data class NfaChainStageDto(
  val seq: Int = 0,
  val roleKey: String? = null,
  val status: String? = null,
  val remarks: String? = null,
  val actedAt: String? = null,
  val approver: NfaApproverDto? = null,
)

@Serializable
data class NfaApprovalDto(
  val status: String? = null,
  val currentStageSeq: Int? = null,
  val chain: List<NfaChainStageDto> = emptyList(),
)

@Serializable
data class NfaDetailDto(
  val id: Long,
  val nfaCode: String? = null,
  val employee: NfaEmployeeDto? = null,
  val raiseFor: String? = null,
  val businessOperation: NfaOptionDto? = null,
  val groupCompany: NfaOptionDto? = null,
  val project: NfaOptionDto? = null,
  val expenseCategory: NfaOptionDto? = null,
  val zone: NfaOptionDto? = null,
  val location: NfaOptionDto? = null,
  val clientVendor: NfaOptionDto? = null,
  val expenseMonth: Int? = null,
  val paymentType: String? = null,
  val billableType: String? = null,
  val billedState: String? = null,
  val invoiceDate: String? = null,
  val invoiceAmount: Double? = null,
  val expectedPaymentDate: String? = null,
  val settlementDueDate: String? = null,
  val purpose: String? = null,
  val description: String? = null,
  val priority: String? = null,
  val status: String? = null,
  val statusLabel: String? = null,
  val settlementStatus: String? = null,
  val createdAt: String? = null,
  val totals: NfaTotalsDto? = null,
  val lines: List<NfaLineDto> = emptyList(),
  val approval: NfaApprovalDto? = null,
)

// ---- Act / resubmit ----

@Serializable
data class NfaActRequest(
  val action: String,
  val remarks: String? = null,
)

@Serializable
data class NfaResubmitRequest(
  val remarks: String? = null,
)

// ---- Ledger (GET /nfa/ledger) ----

@Serializable
data class NfaLedgerDto(
  val financialYear: String? = null,
  val totalRaised: Double = 0.0,
  val paymentsReleased: Double = 0.0,
  val settled: Double = 0.0,
  val amountReceived: Double = 0.0,
  val settlementAmount: Double = 0.0,
  val balanceToSettle: Double = 0.0,
)
