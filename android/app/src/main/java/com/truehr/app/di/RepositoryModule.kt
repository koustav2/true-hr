package com.truehr.app.di

import com.truehr.app.data.repository.AttendanceRepositoryImpl
import com.truehr.app.data.repository.AuthRepositoryImpl
import com.truehr.app.data.repository.MissPunchRepositoryImpl
import com.truehr.app.data.repository.CompOffRepositoryImpl
import com.truehr.app.data.repository.LeaveRepositoryImpl
import com.truehr.app.data.repository.OnDutyRepositoryImpl
import com.truehr.app.data.repository.ProfileRepositoryImpl
import com.truehr.app.domain.repository.AttendanceRepository
import com.truehr.app.domain.repository.AuthRepository
import com.truehr.app.domain.repository.MissPunchRepository
import com.truehr.app.domain.repository.CompOffRepository
import com.truehr.app.domain.repository.LeaveRepository
import com.truehr.app.domain.repository.OnDutyRepository
import com.truehr.app.domain.repository.ProfileRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
  @Binds @Singleton
  abstract fun bindAuthRepository(impl: AuthRepositoryImpl): AuthRepository

  @Binds @Singleton
  abstract fun bindProfileRepository(impl: ProfileRepositoryImpl): ProfileRepository

  @Binds @Singleton
  abstract fun bindAttendanceRepository(impl: AttendanceRepositoryImpl): AttendanceRepository

  @Binds @Singleton
  abstract fun bindMissPunchRepository(impl: MissPunchRepositoryImpl): MissPunchRepository

  @Binds @Singleton
  abstract fun bindOnDutyRepository(impl: OnDutyRepositoryImpl): OnDutyRepository

  @Binds @Singleton
  abstract fun bindLeaveRepository(impl: LeaveRepositoryImpl): LeaveRepository

  @Binds @Singleton
  abstract fun bindCompOffRepository(impl: CompOffRepositoryImpl): CompOffRepository
}
