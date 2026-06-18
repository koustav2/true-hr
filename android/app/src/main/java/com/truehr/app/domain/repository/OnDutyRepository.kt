package com.truehr.app.domain.repository

import com.truehr.app.domain.model.OnDuty

interface OnDutyRepository {
  suspend fun apply(fromDate: String, toDate: String, dayType: String, place: String?, reason: String?, photo: String?)
  suspend fun list(status: String): List<OnDuty>
  suspend fun team(status: String): List<OnDuty>
  suspend fun review(id: Long, decision: String, note: String?)
}
