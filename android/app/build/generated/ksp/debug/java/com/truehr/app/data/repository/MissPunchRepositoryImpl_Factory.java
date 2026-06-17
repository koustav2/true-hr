package com.truehr.app.data.repository;

import com.truehr.app.data.remote.ApiService;
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
public final class MissPunchRepositoryImpl_Factory implements Factory<MissPunchRepositoryImpl> {
  private final Provider<ApiService> apiProvider;

  public MissPunchRepositoryImpl_Factory(Provider<ApiService> apiProvider) {
    this.apiProvider = apiProvider;
  }

  @Override
  public MissPunchRepositoryImpl get() {
    return newInstance(apiProvider.get());
  }

  public static MissPunchRepositoryImpl_Factory create(Provider<ApiService> apiProvider) {
    return new MissPunchRepositoryImpl_Factory(apiProvider);
  }

  public static MissPunchRepositoryImpl newInstance(ApiService api) {
    return new MissPunchRepositoryImpl(api);
  }
}
