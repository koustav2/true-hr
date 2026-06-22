import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.android)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
  alias(libs.plugins.hilt)
  alias(libs.plugins.ksp)
}

// Read the Google Maps API key from local.properties (kept out of git).
// Add a line:  MAPS_API_KEY=AIza...your key...
val localProps = Properties().apply {
  val f = rootProject.file("local.properties")
  if (f.exists()) f.inputStream().use { load(it) }
}
val mapsApiKey: String = localProps.getProperty("MAPS_API_KEY") ?: ""

android {
  namespace = "com.truehr.app"
  compileSdk = 34

  defaultConfig {
    applicationId = "com.truehr.app"
    minSdk = 24
    targetSdk = 34
    versionCode = 1
    versionName = "1.0.0"
    vectorDrawables { useSupportLibrary = true }

    // Base URL of the TRUE HR backend. Use 10.0.2.2 to reach localhost from the emulator.
    buildConfigField("String", "BASE_URL", "\"https://api.truehr.co.in/api/\"")

    // Injected into AndroidManifest as the Google Maps API key.
    manifestPlaceholders["MAPS_API_KEY"] = mapsApiKey
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
  buildFeatures {
    compose = true
    buildConfig = true
  }
}

dependencies {
  implementation(libs.androidx.core.ktx)
  implementation(libs.androidx.lifecycle.runtime.ktx)
  implementation(libs.androidx.lifecycle.viewmodel.compose)
  implementation(libs.androidx.activity.compose)

  implementation(platform(libs.androidx.compose.bom))
  implementation(libs.androidx.ui)
  implementation(libs.androidx.ui.graphics)
  implementation(libs.androidx.ui.tooling.preview)
  implementation(libs.androidx.material3)
  implementation(libs.androidx.material.icons.extended)
  debugImplementation(libs.androidx.ui.tooling)

  implementation(libs.androidx.navigation.compose)
  implementation(libs.hilt.navigation.compose)

  implementation(libs.hilt.android)
  ksp(libs.hilt.compiler)

  implementation(libs.retrofit)
  implementation(libs.retrofit.kotlinx.serialization)
  implementation(libs.kotlinx.serialization.json)
  implementation(libs.okhttp)
  implementation(libs.okhttp.logging)

  implementation(libs.androidx.datastore.preferences)
  implementation(libs.coil.compose)
  implementation(libs.play.services.location)

  // Tour Management: maps, offline buffer (Room), background sync (WorkManager + Hilt)
  implementation(libs.maps.compose)
  implementation(libs.play.services.maps)
  implementation(libs.androidx.room.runtime)
  implementation(libs.androidx.room.ktx)
  ksp(libs.androidx.room.compiler)
  implementation(libs.androidx.work.runtime)
  implementation(libs.androidx.hilt.work)
  ksp(libs.androidx.hilt.compiler)
}
