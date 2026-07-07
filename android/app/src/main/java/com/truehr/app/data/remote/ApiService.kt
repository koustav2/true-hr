package com.truehr.app.data.remote

import com.truehr.app.data.remote.dto.ApplyMissPunchRequest
import com.truehr.app.data.remote.dto.AttendanceRecordDto
import com.truehr.app.data.remote.dto.ChangePasswordRequest
import com.truehr.app.data.remote.dto.HoldRequest
import com.truehr.app.data.remote.dto.LoginRequest
import com.truehr.app.data.remote.dto.LoginResponse
import com.truehr.app.data.remote.dto.MeDto
import com.truehr.app.data.remote.dto.MissPunchDto
import com.truehr.app.data.remote.dto.MonthlyDto
import com.truehr.app.data.remote.dto.ApplyOdRequest
import com.truehr.app.data.remote.dto.OdDto
import com.truehr.app.data.remote.dto.OdReviewRequest
import com.truehr.app.data.remote.dto.ProfileDto
import com.truehr.app.data.remote.dto.PunchRequest
import com.truehr.app.data.remote.dto.PunchResponse
import com.truehr.app.data.remote.dto.TeamMemberDto
import com.truehr.app.data.remote.dto.TodayDto
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

interface ApiService {
  @POST("auth/login")
  suspend fun login(@Body body: LoginRequest): LoginResponse

  @GET("me")
  suspend fun me(): MeDto

  @GET("me/profile")
  suspend fun profile(): ProfileDto

  @GET("me/team")
  suspend fun myTeam(): List<com.truehr.app.data.remote.dto.TeamMateDto>

  @GET("me/directory")
  suspend fun directory(): List<com.truehr.app.data.remote.dto.DirectoryEntryDto>

  @POST("auth/change-password")
  suspend fun changePassword(@Body body: ChangePasswordRequest)

  // Attendance
  @POST("attendance/punch")
  suspend fun punch(@Body body: PunchRequest): PunchResponse

  @GET("attendance/today")
  suspend fun attendanceToday(): TodayDto

  @GET("attendance/daily")
  suspend fun attendanceDaily(@Query("year") year: Int, @Query("month") month: Int, @Query("employeeId") employeeId: Long? = null): List<AttendanceRecordDto>

  @GET("attendance/regularized")
  suspend fun attendanceRegularized(@Query("year") year: Int, @Query("month") month: Int, @Query("employeeId") employeeId: Long? = null): List<Int>

  @GET("attendance/monthly")
  suspend fun attendanceMonthly(@Query("year") year: Int, @Query("month") month: Int, @Query("employeeId") employeeId: Long? = null): MonthlyDto

  @GET("attendance/team")
  suspend fun attendanceTeam(): List<TeamMemberDto>

  @POST("attendance/team/hold")
  suspend fun holdTeam(@Body body: HoldRequest)

  @POST("attendance/team/release")
  suspend fun releaseTeam(@Body body: HoldRequest)

  // Miss punch
  @POST("misspunch")
  suspend fun missPunchApply(@Body body: ApplyMissPunchRequest)

  @GET("misspunch")
  suspend fun missPunchList(@Query("status") status: String): List<MissPunchDto>

  @GET("misspunch/team")
  suspend fun missPunchTeam(@Query("status") status: String): List<MissPunchDto>

  @POST("misspunch/{id}/review")
  suspend fun missPunchReview(@Path("id") id: Long, @Body body: OdReviewRequest)

  // On-duty (OD)
  @GET("onduty/eligibility")
  suspend fun odEligibility(): com.truehr.app.data.remote.dto.OdEligibilityDto

  @POST("onduty")
  suspend fun odApply(@Body body: ApplyOdRequest)

  @GET("onduty")
  suspend fun odList(@Query("status") status: String): List<OdDto>

  @GET("onduty/team")
  suspend fun odTeam(@Query("status") status: String): List<OdDto>

  @POST("onduty/{id}/review")
  suspend fun odReview(@Path("id") id: Long, @Body body: OdReviewRequest)

  // Leave management
  @GET("leave/types")
  suspend fun leaveTypes(): List<com.truehr.app.data.remote.dto.LeaveTypeDto>

  @GET("leave/balances")
  suspend fun leaveBalances(): List<com.truehr.app.data.remote.dto.LeaveBalanceDto>

  @POST("leave")
  suspend fun leaveApply(@Body body: com.truehr.app.data.remote.dto.ApplyLeaveRequest)

  @GET("leave")
  suspend fun leaveList(@Query("status") status: String): List<com.truehr.app.data.remote.dto.LeaveRequestDto>

  @GET("leave/team")
  suspend fun leaveTeam(@Query("status") status: String): List<com.truehr.app.data.remote.dto.LeaveRequestDto>

  @POST("leave/{id}/review")
  suspend fun leaveReview(@Path("id") id: Long, @Body body: OdReviewRequest)

  @POST("leave/{id}/cancel")
  suspend fun leaveCancel(@Path("id") id: Long)

  // Comp-Off
  @GET("compoff/credits")
  suspend fun compOffCredits(): List<com.truehr.app.data.remote.dto.CompOffCreditDto>

  @POST("compoff")
  suspend fun compOffApply(@Body body: com.truehr.app.data.remote.dto.ApplyCompOffRequest)

  @GET("compoff")
  suspend fun compOffList(@Query("status") status: String): List<com.truehr.app.data.remote.dto.CompOffRequestDto>

  @GET("compoff/team")
  suspend fun compOffTeam(@Query("status") status: String): List<com.truehr.app.data.remote.dto.CompOffRequestDto>

  @POST("compoff/{id}/review")
  suspend fun compOffReview(@Path("id") id: Long, @Body body: OdReviewRequest)

  // Support Desk
  // Policies
  @GET("policies")
  suspend fun policies(): List<com.truehr.app.data.remote.dto.PolicyDto>

  @Streaming
  @GET("policies/{id}/file")
  suspend fun policyFile(@Path("id") id: Long): ResponseBody

  // Dashboard banner carousel (images load via Coil from banners/{id}/image)
  @GET("banners")
  suspend fun banners(): List<com.truehr.app.data.remote.dto.BannerDto>

  // Tasks
  @GET("tasks")
  suspend fun tasks(
    @Query("status") status: String? = null,
    @Query("from") from: String? = null,
    @Query("to") to: String? = null,
  ): List<com.truehr.app.data.remote.dto.TaskDto>

  @GET("tasks/summary")
  suspend fun taskSummary(): com.truehr.app.data.remote.dto.TaskSummaryDto

  @GET("tasks/team")
  suspend fun taskTeam(
    @Query("memberId") memberId: Long? = null,
    @Query("status") status: String? = null,
    @Query("from") from: String? = null,
    @Query("to") to: String? = null,
  ): List<com.truehr.app.data.remote.dto.TaskDto>

  @GET("tasks/team/summary")
  suspend fun taskTeamSummary(
    @Query("from") from: String? = null,
    @Query("to") to: String? = null,
  ): List<com.truehr.app.data.remote.dto.TeamTaskSummaryDto>

  @POST("tasks")
  suspend fun taskCreate(@Body body: com.truehr.app.data.remote.dto.CreateTaskRequest)

  @POST("tasks/{id}/status")
  suspend fun taskStatus(@Path("id") id: Long, @Body body: com.truehr.app.data.remote.dto.UpdateTaskStatusRequest)

  // Resignation
  @GET("resignation/context")
  suspend fun resignationContext(): com.truehr.app.data.remote.dto.ResignationContextDto

  @POST("resignation")
  suspend fun resignationApply(@Body body: com.truehr.app.data.remote.dto.ApplyResignationRequest)

  @POST("resignation/{id}/withdraw")
  suspend fun resignationWithdraw(@Path("id") id: Long)

  @GET("resignation/team")
  suspend fun resignationTeam(@Query("status") status: String): List<com.truehr.app.data.remote.dto.ResignationDto>

  @POST("resignation/{id}/review")
  suspend fun resignationReview(@Path("id") id: Long, @Body body: OdReviewRequest)

  // Salary Slip
  @GET("payslips")
  suspend fun payslips(): List<com.truehr.app.data.remote.dto.PayslipRowDto>

  @GET("payslips/{id}")
  suspend fun payslip(@Path("id") id: Long): com.truehr.app.data.remote.dto.PayslipDto

  @Streaming
  @GET("payslips/{id}/pdf")
  suspend fun payslipPdf(@Path("id") id: Long): ResponseBody

  // Tour Management
  @POST("tours/start")
  suspend fun tourStart(@Body body: com.truehr.app.data.remote.dto.StartTourRequest): com.truehr.app.data.remote.dto.TourDto

  @GET("tours")
  suspend fun tours(
    @Query("from") from: String? = null,
    @Query("to") to: String? = null,
  ): List<com.truehr.app.data.remote.dto.TourDto>

  @GET("tours/{id}")
  suspend fun tourDetail(@Path("id") id: Long): com.truehr.app.data.remote.dto.TourDetailDto

  @POST("tours/{id}/points")
  suspend fun tourAddPoints(@Path("id") id: Long, @Body body: com.truehr.app.data.remote.dto.AddPointsRequest)

  @POST("tours/{id}/end")
  suspend fun tourEnd(@Path("id") id: Long, @Body body: com.truehr.app.data.remote.dto.EndTourRequest): com.truehr.app.data.remote.dto.TourDto

  @POST("geotags")
  suspend fun geotagCreate(@Body body: com.truehr.app.data.remote.dto.CreateGeotagRequest)

  @GET("geotags")
  suspend fun geotags(
    @Query("from") from: String? = null,
    @Query("to") to: String? = null,
  ): List<com.truehr.app.data.remote.dto.GeotagDto>

  // NFA (Note For Approval)
  @GET("meta/nfa-masters")
  suspend fun nfaMasters(): com.truehr.app.data.remote.dto.NfaMastersDto

  @GET("approvals/preview")
  suspend fun nfaApprovalPreview(
    @Query("flow") flow: String = "NFA",
    @Query("projectId") projectId: Long? = null,
    @Query("expenseCategoryId") expenseCategoryId: Long? = null,
    @Query("zoneId") zoneId: Long? = null,
  ): List<com.truehr.app.data.remote.dto.NfaPreviewStageDto>

  @POST("nfa")
  suspend fun nfaCreate(@Body body: com.truehr.app.data.remote.dto.CreateNfaRequest): com.truehr.app.data.remote.dto.NfaDetailDto

  @GET("nfa")
  suspend fun nfaList(
    @Query("year") year: Int? = null,
    @Query("month") month: Int? = null,
    @Query("status") status: String? = null,
  ): List<com.truehr.app.data.remote.dto.NfaRowDto>

  @GET("nfa/pending")
  suspend fun nfaPending(): List<com.truehr.app.data.remote.dto.NfaRowDto>

  @GET("nfa/ledger")
  suspend fun nfaLedger(): com.truehr.app.data.remote.dto.NfaLedgerDto

  @GET("nfa/{id}")
  suspend fun nfaDetail(@Path("id") id: Long): com.truehr.app.data.remote.dto.NfaDetailDto

  @POST("nfa/{id}/act")
  suspend fun nfaAct(@Path("id") id: Long, @Body body: com.truehr.app.data.remote.dto.NfaActRequest): com.truehr.app.data.remote.dto.NfaDetailDto

  @POST("nfa/{id}/resubmit")
  suspend fun nfaResubmit(@Path("id") id: Long, @Body body: com.truehr.app.data.remote.dto.NfaResubmitRequest): com.truehr.app.data.remote.dto.NfaDetailDto

  // NFA settlements
  @POST("nfa/{id}/settlement")
  suspend fun settlementSubmit(@Path("id") nfaId: Long, @Body body: com.truehr.app.data.remote.dto.SubmitSettlementRequest): com.truehr.app.data.remote.dto.SettlementDto

  @GET("nfa/{id}/settlement")
  suspend fun settlementForNfa(@Path("id") nfaId: Long): com.truehr.app.data.remote.dto.SettlementDto

  @GET("settlements/pending")
  suspend fun settlementsPending(): List<com.truehr.app.data.remote.dto.SettlementDto>

  @POST("settlements/{id}/act")
  suspend fun settlementAct(@Path("id") id: Long, @Body body: com.truehr.app.data.remote.dto.NfaActRequest): com.truehr.app.data.remote.dto.SettlementDto

  // PMS / KPI
  @GET("kpi")
  suspend fun kpiList(@Query("year") year: Int? = null): List<com.truehr.app.data.remote.dto.KpiRowDto>

  @POST("kpi")
  suspend fun kpiCreate(@Body body: com.truehr.app.data.remote.dto.CreateKpiRequest): com.truehr.app.data.remote.dto.KpiDetailDto

  @GET("kpi/team-pending")
  suspend fun kpiTeamPending(): List<com.truehr.app.data.remote.dto.TeamKpiRowDto>

  @GET("kpi/{id}")
  suspend fun kpiDetail(@Path("id") id: Long): com.truehr.app.data.remote.dto.KpiDetailDto

  @POST("kpi/{id}/review")
  suspend fun kpiReview(@Path("id") id: Long, @Body body: com.truehr.app.data.remote.dto.KpiReviewRequest): com.truehr.app.data.remote.dto.KpiDetailDto

  @POST("kpi/{id}/pms")
  suspend fun pmsSubmit(@Path("id") kpiId: Long, @Body body: com.truehr.app.data.remote.dto.SubmitPmsRequest): com.truehr.app.data.remote.dto.KpiDetailDto

  @GET("pms/pending")
  suspend fun pmsPending(): List<com.truehr.app.data.remote.dto.PendingRatingDto>

  @POST("pms/{id}/rate")
  suspend fun pmsRate(@Path("id") submissionId: Long, @Body body: com.truehr.app.data.remote.dto.RatePmsRequest): com.truehr.app.data.remote.dto.KpiDetailDto

  @retrofit2.http.POST("auth/web-sso-token")
  suspend fun webSsoToken(): com.truehr.app.data.remote.dto.WebSsoTokenDto

  // Vendors & agreements
  @GET("vendors")
  suspend fun vendors(): List<com.truehr.app.data.remote.dto.VendorDto>

  @POST("vendors")
  suspend fun vendorCreate(@Body body: com.truehr.app.data.remote.dto.CreateVendorRequest): com.truehr.app.data.remote.dto.VendorDto

  @GET("agreements")
  suspend fun agreements(): List<com.truehr.app.data.remote.dto.AgreementDto>

  @POST("agreements")
  suspend fun agreementCreate(@Body body: com.truehr.app.data.remote.dto.CreateAgreementRequest): com.truehr.app.data.remote.dto.AgreementDto

  @GET("support/catalog")
  suspend fun supportCatalog(): com.truehr.app.data.remote.dto.SupportCatalogDto

  @POST("support")
  suspend fun supportCreate(@Body body: com.truehr.app.data.remote.dto.CreateTicketRequest)

  @GET("support")
  suspend fun supportList(
    @Query("category") category: String,
    @Query("from") from: String? = null,
    @Query("to") to: String? = null,
  ): List<com.truehr.app.data.remote.dto.SupportTicketDto>
}
