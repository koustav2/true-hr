package com.truehr.app.domain.repository

import com.truehr.app.domain.model.LeaveBalance
import com.truehr.app.domain.model.LeaveRequest
import com.truehr.app.domain.model.LeaveType

interface LeaveRepository {
  suspend fun types(): List<LeaveType>
  suspend fun balances(): List<LeaveBalance>
  suspend fun apply(leaveCode: String, fromDate: String, toDate: String, reason: String?)
  suspend fun list(status: String): List<LeaveRequest>
  suspend fun team(status: String): List<LeaveRequest>
  suspend fun review(id: Long, decision: String, note: String?)
}
