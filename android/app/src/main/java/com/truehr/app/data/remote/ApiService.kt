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
