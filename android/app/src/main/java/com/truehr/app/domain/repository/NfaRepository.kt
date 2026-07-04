package com.truehr.app.domain.repository

import com.truehr.app.domain.model.NfaCreateInput
import com.truehr.app.domain.model.NfaDetail
import com.truehr.app.domain.model.NfaLedger
import com.truehr.app.domain.model.NfaMasters
import com.truehr.app.domain.model.NfaPreviewStage
import com.truehr.app.domain.model.NfaRow

interface NfaRepository {
  suspend fun masters(): NfaMasters
  suspend fun approvalPreview(projectId: Long?, expenseCategoryId: Long?, zoneId: Long?): List<NfaPreviewStage>
  suspend fun create(input: NfaCreateInput): NfaDetail
  suspend fun list(year: Int?, month: Int?, status: String?): List<NfaRow>
  suspend fun pending(): List<NfaRow>
  suspend fun detail(id: Long): NfaDetail
  suspend fun act(id: Long, action: String, remarks: String?): NfaDetail
  suspend fun resubmit(id: Long, remarks: String): NfaDetail
  suspend fun ledger(): NfaLedger
}
