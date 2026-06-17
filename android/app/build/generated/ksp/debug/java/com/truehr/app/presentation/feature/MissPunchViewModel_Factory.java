package com.truehr.app.presentation.feature;

import com.truehr.app.domain.repository.MissPunchRepository;
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
public final class MissPunchViewModel_Factory implements Factory<MissPunchViewModel> {
  private final Provider<MissPunchRepository> repoProvider;

  public MissPunchViewModel_Factory(Provider<MissPunchRepository> repoProvider) {
    this.repoProvider = repoProvider;
  }

  @Override
  public MissPunchViewModel get() {
    return newInstance(repoProvider.get());
  }

  public static MissPunchViewModel_Factory create(Provider<MissPunchRepository> repoProvider) {
    return new MissPunchViewModel_Factory(repoProvider);
  }

  public static MissPunchViewModel newInstance(MissPunchRepository repo) {
    return new MissPunchViewModel(repo);
  }
}
