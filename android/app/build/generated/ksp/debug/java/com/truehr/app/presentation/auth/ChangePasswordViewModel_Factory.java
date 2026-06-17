package com.truehr.app.presentation.auth;

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
public final class ChangePasswordViewModel_Factory implements Factory<ChangePasswordViewModel> {
  private final Provider<AuthRepository> authRepositoryProvider;

  public ChangePasswordViewModel_Factory(Provider<AuthRepository> authRepositoryProvider) {
    this.authRepositoryProvider = authRepositoryProvider;
  }

  @Override
  public ChangePasswordViewModel get() {
    return newInstance(authRepositoryProvider.get());
  }

  public static ChangePasswordViewModel_Factory create(
      Provider<AuthRepository> authRepositoryProvider) {
    return new ChangePasswordViewModel_Factory(authRepositoryProvider);
  }

  public static ChangePasswordViewModel newInstance(AuthRepository authRepository) {
    return new ChangePasswordViewModel(authRepository);
  }
}
