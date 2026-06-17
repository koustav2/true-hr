package com.truehr.app.presentation.dashboard;

import com.truehr.app.domain.repository.AuthRepository;
import com.truehr.app.domain.repository.ProfileRepository;
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
public final class DashboardViewModel_Factory implements Factory<DashboardViewModel> {
  private final Provider<ProfileRepository> profileRepositoryProvider;

  private final Provider<AuthRepository> authRepositoryProvider;

  public DashboardViewModel_Factory(Provider<ProfileRepository> profileRepositoryProvider,
      Provider<AuthRepository> authRepositoryProvider) {
    this.profileRepositoryProvider = profileRepositoryProvider;
    this.authRepositoryProvider = authRepositoryProvider;
  }

  @Override
  public DashboardViewModel get() {
    return newInstance(profileRepositoryProvider.get(), authRepositoryProvider.get());
  }

  public static DashboardViewModel_Factory create(
      Provider<ProfileRepository> profileRepositoryProvider,
      Provider<AuthRepository> authRepositoryProvider) {
    return new DashboardViewModel_Factory(profileRepositoryProvider, authRepositoryProvider);
  }

  public static DashboardViewModel newInstance(ProfileRepository profileRepository,
      AuthRepository authRepository) {
    return new DashboardViewModel(profileRepository, authRepository);
  }
}
