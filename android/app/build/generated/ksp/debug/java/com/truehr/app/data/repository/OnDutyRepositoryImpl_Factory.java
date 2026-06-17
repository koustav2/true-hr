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
public final class OnDutyRepositoryImpl_Factory implements Factory<OnDutyRepositoryImpl> {
  private final Provider<ApiService> apiProvider;

  public OnDutyRepositoryImpl_Factory(Provider<ApiService> apiProvider) {
    this.apiProvider = apiProvider;
  }

  @Override
  public OnDutyRepositoryImpl get() {
    return newInstance(apiProvider.get());
  }

  public static OnDutyRepositoryImpl_Factory create(Provider<ApiService> apiProvider) {
    return new OnDutyRepositoryImpl_Factory(apiProvider);
  }

  public static OnDutyRepositoryImpl newInstance(ApiService api) {
    return new OnDutyRepositoryImpl(api);
  }
}
