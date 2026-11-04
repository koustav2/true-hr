package com.truehr.app.domain.repository

import com.truehr.app.domain.model.LeaveBalance
import com.truehr.app.domain.model.LeaveRequest
import com.truehr.app.domain.model.LeaveType

interface LeaveRepository {
  suspend fun types(): List<LeaveType>
  suspend fun balances(): List<LeaveBalance>
  /** Returns who the request now waits with (E9), when the server says. */
  suspend fun apply(leaveCode: String, fromDate: String, toDate: String, reason: String?, halfDay: Boolean, halfDaySession: String?, certificate: String?, certificateMime: String?, certificateName: String?): String?
  suspend fun holidays(year: Int): List<com.truehr.app.domain.model.Holiday>
  suspend fun list(status: String): List<LeaveRequest>
  suspend fun team(status: String): List<LeaveRequest>
  suspend fun review(id: Long, decision: String, note: String?)
  suspend fun cancel(id: Long)
}
