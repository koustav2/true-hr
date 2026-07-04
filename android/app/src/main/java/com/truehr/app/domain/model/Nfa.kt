package com.truehr.app.domain.model

data class NfaOption(val id: Long, val name: String)

data class NfaProject(
  val id: Long,
  val name: String,
  val businessOperationId: Long?,
  val groupCompanyId: Long?,
)

data class NfaLocation(val id: Long, val name: String, val kind: String?)

data class NfaClientVendor(val id: Long, val name: String, val type: String?)

data class NfaExpenseCategory(val id: Long, val name: String, val businessOperationId: Long?)

data class NfaExpenseHeader(val id: Long, val name: String, val categoryId: Long?)

data class NfaExpenseSubheader(val id: Long, val name: String, val headerId: Long?)

data class NfaMasters(
  val businessOperations: List<NfaOption>,
  val groupCompanies: List<NfaOption>,
  val costZones: List<NfaOption>,
  val projects: List<NfaProject>,
  val locations: List<NfaLocation>,
  val clientsVendors: List<NfaClientVendor>,
  val expenseCategories: List<NfaExpenseCategory>,
  val expenseHeaders: List<NfaExpenseHeader>,
  val expenseSubheaders: List<NfaExpenseSubheader>,
)

data class NfaApprover(
  val id: Long?,
  val employeeCode: String?,
  val name: String?,
  val email: String?,
)

data class NfaPreviewStage(
  val seq: Int,
  val roleKey: String,
  val approver: NfaApprover?,
  val willBypass: Boolean,
)

data class NfaTotals(val nfa: Double, val logistic: Double, val grand: Double)

data class NfaRow(
  val id: Long,
  val nfaCode: String,
  val employeeCode: String,
  val employeeName: String,
  val projectName: String,
  val expenseCategoryName: String,
  val paymentType: String,
  val billableType: String,
  val totals: NfaTotals,
  val status: String,
  val statusLabel: String,
  val createdAt: String?,
  val settlementDueDate: String?,
  val priority: String,
  val pendingStageSeq: Int?,
  val pendingStageRole: String?,
)

data class NfaLine(
  val seq: Int,
  val headerName: String,
  val subheaderName: String?,
  val nfaAmount: Double,
  val logisticAmount: Double,
  val totalAmount: Double,
)

data class NfaChainStage(
  val seq: Int,
  val roleKey: String,
  val status: String,
  val remarks: String?,
  val actedAt: String?,
  val approverName: String?,
)

data class NfaApproval(
  val status: String,
  val currentStageSeq: Int?,
  val chain: List<NfaChainStage>,
)

data class NfaDetail(
  val id: Long,
  val nfaCode: String,
  val employeeCode: String,
  val employeeName: String,
  val raiseFor: String,
  val businessOperation: String,
  val groupCompany: String,
  val project: String,
  val expenseCategory: String,
  val zone: String,
  val location: String,
  val clientVendor: String?,
  val expenseMonth: Int?,
  val paymentType: String,
  val billableType: String,
  val billedState: String?,
  val invoiceDate: String?,
  val invoiceAmount: Double?,
  val expectedPaymentDate: String?,
  val settlementDueDate: String?,
  val purpose: String?,
  val description: String?,
  val priority: String,
  val status: String,
  val statusLabel: String,
  val settlementStatus: String?,
  val createdAt: String?,
  val totals: NfaTotals,
  val lines: List<NfaLine>,
  val approval: NfaApproval?,
)

data class NfaLedger(
  val financialYear: String,
  val totalRaised: Double,
  val paymentsReleased: Double,
  val settled: Double,
  val amountReceived: Double,
  val settlementAmount: Double,
  val balanceToSettle: Double,
)

data class NfaLineInput(
  val headerId: Long,
  val subheaderId: Long?,
  val nfaAmount: Double,
  val logisticAmount: Double,
)

data class NfaCreateInput(
  val raiseFor: String,
  val businessOperationId: Long,
  val groupCompanyId: Long,
  val projectId: Long,
  val expenseCategoryId: Long,
  val zoneId: Long,
  val locationId: Long,
  val clientVendorId: Long?,
  val expenseMonth: Int,
  val paymentType: String,
  val billableType: String,
  val billedState: String?,
  val invoiceDate: String?,
  val invoiceAmount: Double?,
  val expectedPaymentDate: String?,
  val settlementDueDate: String,
  val purpose: String,
  val description: String?,
  val priority: String,
  val lines: List<NfaLineInput>,
)
