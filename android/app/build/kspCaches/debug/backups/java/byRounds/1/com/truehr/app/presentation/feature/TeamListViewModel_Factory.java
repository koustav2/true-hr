package com.truehr.app.presentation.feature;

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
public final class TeamListViewModel_Factory implements Factory<TeamListViewModel> {
  private final Provider<ProfileRepository> repoProvider;

  public TeamListViewModel_Factory(Provider<ProfileRepository> repoProvider) {
    this.repoProvider = repoProvider;
  }

  @Override
  public TeamListViewModel get() {
    return newInstance(repoProvider.get());
  }

  public static TeamListViewModel_Factory create(Provider<ProfileRepository> repoProvider) {
    return new TeamListViewModel_Factory(repoProvider);
  }

  public static TeamListViewModel newInstance(ProfileRepository repo) {
    return new TeamListViewModel(repo);
  }
}
