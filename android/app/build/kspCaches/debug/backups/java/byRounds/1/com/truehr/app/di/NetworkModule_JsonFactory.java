package com.truehr.app.di;

import dagger.internal.DaggerGenerated;
import dagger.internal.Factory;
import dagger.internal.Preconditions;
import dagger.internal.QualifierMetadata;
import dagger.internal.ScopeMetadata;
import javax.annotation.processing.Generated;
import kotlinx.serialization.json.Json;

@ScopeMetadata("javax.inject.Singleton")
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
public final class NetworkModule_JsonFactory implements Factory<Json> {
  @Override
  public Json get() {
    return json();
  }

  public static NetworkModule_JsonFactory create() {
    return InstanceHolder.INSTANCE;
  }

  public static Json json() {
    return Preconditions.checkNotNullFromProvides(NetworkModule.INSTANCE.json());
  }

  private static final class InstanceHolder {
    private static final NetworkModule_JsonFactory INSTANCE = new NetworkModule_JsonFactory();
  }
}
