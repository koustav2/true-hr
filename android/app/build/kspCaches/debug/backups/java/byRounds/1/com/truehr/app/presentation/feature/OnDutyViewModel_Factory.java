package com.truehr.app.presentation.feature;

import com.truehr.app.domain.repository.OnDutyRepository;
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
public final class OnDutyViewModel_Factory implements Factory<OnDutyViewModel> {
  private final Provider<OnDutyRepository> repoProvider;

  public OnDutyViewModel_Factory(Provider<OnDutyRepository> repoProvider) {
    this.repoProvider = repoProvider;
  }

  @Override
  public OnDutyViewModel get() {
    return newInstance(repoProvider.get());
  }

  public static OnDutyViewModel_Factory create(Provider<OnDutyRepository> repoProvider) {
    return new OnDutyViewModel_Factory(repoProvider);
  }

  public static OnDutyViewModel newInstance(OnDutyRepository repo) {
    return new OnDutyViewModel(repo);
  }
}
