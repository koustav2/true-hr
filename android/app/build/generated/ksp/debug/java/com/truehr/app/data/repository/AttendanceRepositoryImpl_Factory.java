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
public final class AttendanceRepositoryImpl_Factory implements Factory<AttendanceRepositoryImpl> {
  private final Provider<ApiService> apiProvider;

  public AttendanceRepositoryImpl_Factory(Provider<ApiService> apiProvider) {
    this.apiProvider = apiProvider;
  }

  @Override
  public AttendanceRepositoryImpl get() {
    return newInstance(apiProvider.get());
  }

  public static AttendanceRepositoryImpl_Factory create(Provider<ApiService> apiProvider) {
    return new AttendanceRepositoryImpl_Factory(apiProvider);
  }

  public static AttendanceRepositoryImpl newInstance(ApiService api) {
    return new AttendanceRepositoryImpl(api);
  }
}
