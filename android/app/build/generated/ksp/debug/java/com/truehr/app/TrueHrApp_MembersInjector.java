package com.truehr.app;

import dagger.MembersInjector;
import dagger.internal.DaggerGenerated;
import dagger.internal.InjectedFieldSignature;
import dagger.internal.QualifierMetadata;
import javax.annotation.processing.Generated;
import javax.inject.Provider;
import okhttp3.OkHttpClient;

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
public final class TrueHrApp_MembersInjector implements MembersInjector<TrueHrApp> {
  private final Provider<OkHttpClient> okHttpClientProvider;

  public TrueHrApp_MembersInjector(Provider<OkHttpClient> okHttpClientProvider) {
    this.okHttpClientProvider = okHttpClientProvider;
  }

  public static MembersInjector<TrueHrApp> create(Provider<OkHttpClient> okHttpClientProvider) {
    return new TrueHrApp_MembersInjector(okHttpClientProvider);
  }

  @Override
  public void injectMembers(TrueHrApp instance) {
    injectOkHttpClient(instance, okHttpClientProvider.get());
  }

  @InjectedFieldSignature("com.truehr.app.TrueHrApp.okHttpClient")
  public static void injectOkHttpClient(TrueHrApp instance, OkHttpClient okHttpClient) {
    instance.okHttpClient = okHttpClient;
  }
}
