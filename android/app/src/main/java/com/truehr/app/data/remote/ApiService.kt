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
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

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
  @POST("onduty")
  suspend fun odApply(@Body body: ApplyOdRequest)

  @GET("onduty")
  suspend fun odList(@Query("status") status: String): List<OdDto>

  @GET("onduty/team")
  suspend fun odTeam(@Query("status") status: String): List<OdDto>

  @POST("onduty/{id}/review")
  suspend fun odReview(@Path("id") id: Long, @Body body: OdReviewRequest)
}
