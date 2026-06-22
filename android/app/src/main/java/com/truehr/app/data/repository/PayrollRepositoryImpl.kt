package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.domain.model.PayLine
import com.truehr.app.domain.model.Payslip
import com.truehr.app.domain.model.PayslipMeta
import com.truehr.app.domain.model.PayslipRow
import com.truehr.app.domain.repository.PayrollRepository
import javax.inject.Inject

class PayrollRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : PayrollRepository {

  override suspend fun list(): List<PayslipRow> = api.payslips().map {
    PayslipRow(it.id, it.year, it.month, it.monthName.orEmpty(), it.employeeCode, it.available)
  }

  override suspend fun detail(id: Long): Payslip {
    val d = api.payslip(id)
    return Payslip(
      id = d.id, year = d.year, month = d.month, monthName = d.monthName.orEmpty(),
      daysInMonth = d.daysInMonth, daysPaid = d.daysPaid, arrears = d.arrears,
      grossEarnings = d.grossEarnings, totalDeductions = d.totalDeductions, netPay = d.netPay,
      earnings = d.earnings.map { PayLine(it.label, it.amount) },
      deductions = d.deductions.map { PayLine(it.label, it.amount) },
      meta = d.meta?.let {
        PayslipMeta(it.name, it.employeeCode, it.designation, it.grade, it.bankName, it.accountNumber, it.pan, it.uan, it.location, it.state)
      },
    )
  }

  override suspend fun pdfBytes(id: Long): ByteArray = api.payslipPdf(id).bytes()
}
