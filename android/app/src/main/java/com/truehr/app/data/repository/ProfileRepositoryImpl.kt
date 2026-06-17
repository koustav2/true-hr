package com.truehr.app.data.repository

import com.truehr.app.data.remote.ApiService
import com.truehr.app.domain.model.Profile
import com.truehr.app.domain.repository.ProfileRepository
import javax.inject.Inject

class ProfileRepositoryImpl @Inject constructor(
  private val api: ApiService,
) : ProfileRepository {
  override suspend fun getProfile(): Profile {
    val d = api.profile()
    return Profile(
      employeeCode = d.employeeCode.orEmpty(),
      fullName = listOfNotNull(d.firstName, d.lastName).joinToString(" ").ifBlank { "—" },
      isManager = d.isManager,
      designation = d.designation ?: "—",
      department = d.department ?: "—",
      company = d.company ?: "—",
      dob = d.dob?.take(10),
      gender = d.gender,
      phone = d.phone,
      personalEmail = d.personalEmail,
      officialEmail = d.officialEmail,
      dateOfJoining = d.dateOfJoining?.take(10),
      location = d.location,
      employmentType = d.employmentType,
      reportingManager = d.reportingManager,
      functionalManager = d.functionalManager,
      address = d.address,
      permanentAddress = d.permanentAddress,
      bankName = d.bank.name,
      bankBranch = d.bank.branch,
      ifsc = d.bank.ifsc,
      accountNumber = d.bank.accountNumber,
      pan = d.statutory.pan,
      aadhaar = d.statutory.aadhaar,
      uan = d.statutory.uan,
      pfNumber = d.statutory.pfNumber,
      esiNumber = d.statutory.esiNumber,
    )
  }
}
