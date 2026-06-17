package com.truehr.app.presentation.feature;

import com.truehr.app.domain.repository.AttendanceRepository;
import dagger.internal.DaggerGenerated;
import dagger.internal.Factory;
import dagger.internal.QualifierMetadata;
import dagger.internal.ScopeMetadata;
import javax.annotation.processing.Generated;
import javax.inject.Provider;

@ScopeMetadata
@QualifierMetadata
@DaggerGenerated
@Generated(
    value = "dagger.internal.codegen.ComponentProcessor",
    comments = "https://dagger.dev"
)
@SuppressWarnings({
    "unchecked",
    "rawtypes",
    "KotlinInternal",
    "KotlinInternalInJava",
    "cast",
    "deprecation"
})
public final class AttendanceViewModel_Factory implements Factory<AttendanceViewModel> {
  private final Provider<AttendanceRepository> repoProvider;

  public AttendanceViewModel_Factory(Provider<AttendanceRepository> repoProvider) {
    this.repoProvider = repoProvider;
  }

  @Override
  public AttendanceViewModel get() {
    return newInstance(repoProvider.get());
  }

  public static AttendanceViewModel_Factory create(Provider<AttendanceRepository> repoProvider) {
    return new AttendanceViewModel_Factory(repoProvider);
  }

  public static AttendanceViewModel newInstance(AttendanceRepository repo) {
    return new AttendanceViewModel(repo);
  }
}
