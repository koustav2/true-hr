package com.truehr.app.domain.repository

import com.truehr.app.domain.model.Payslip
import com.truehr.app.domain.model.PayslipRow

interface PayrollRepository {
  suspend fun list(): List<PayslipRow>
  suspend fun detail(id: Long): Payslip
  suspend fun pdfBytes(id: Long): ByteArray
}
