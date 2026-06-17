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
public final class ProfileRepositoryImpl_Factory implements Factory<ProfileRepositoryImpl> {
  private final Provider<ApiService> apiProvider;

  public ProfileRepositoryImpl_Factory(Provider<ApiService> apiProvider) {
    this.apiProvider = apiProvider;
  }

  @Override
  public ProfileRepositoryImpl get() {
    return newInstance(apiProvider.get());
  }

  public static ProfileRepositoryImpl_Factory create(Provider<ApiService> apiProvider) {
    return new ProfileRepositoryImpl_Factory(apiProvider);
  }

  public static ProfileRepositoryImpl newInstance(ApiService api) {
    return new ProfileRepositoryImpl(api);
  }
}
