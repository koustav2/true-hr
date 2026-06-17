package com.truehr.app.presentation.splash;

import com.truehr.app.domain.repository.AuthRepository;
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
public final class SplashViewModel_Factory implements Factory<SplashViewModel> {
  private final Provider<AuthRepository> authRepositoryProvider;

  public SplashViewModel_Factory(Provider<AuthRepository> authRepositoryProvider) {
    this.authRepositoryProvider = authRepositoryProvider;
  }

  @Override
  public SplashViewModel get() {
    return newInstance(authRepositoryProvider.get());
  }

  public static SplashViewModel_Factory create(Provider<AuthRepository> authRepositoryProvider) {
    return new SplashViewModel_Factory(authRepositoryProvider);
  }

  public static SplashViewModel newInstance(AuthRepository authRepository) {
    return new SplashViewModel(authRepository);
  }
}
