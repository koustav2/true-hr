# ── TrueHR R8/ProGuard rules ─────────────────────────────────────────────────
# Stack: Retrofit 2.11 + OkHttp 4 + kotlinx-serialization + Hilt + Coil +
# Compose + WorkManager. Hilt, Coil, Compose and OkHttp ship their own
# consumer rules — the rules below cover what they don't.

# ── kotlinx-serialization (official rules) ───────────────────────────────────
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**

# Generated serializers for our @Serializable DTOs
-keep,includedescriptorclasses class com.truehr.app.**$$serializer { *; }
-keepclassmembers class com.truehr.app.** {
    *** Companion;
}
-keepclasseswithmembers class com.truehr.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}
# Named companion objects of serializable classes (R8 full mode)
-if @kotlinx.serialization.Serializable class ** {
    public static ** INSTANCE;
}
-keepclassmembers class <1> {
    public static <1> INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}

# ── Retrofit (official rules) ────────────────────────────────────────────────
# Generic signatures are read reflectively for suspend/Call return types.
-keepattributes Signature, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepattributes AnnotationDefault

-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}
# Keep annotated service interfaces (and their hierarchy) as interfaces
-if interface * { @retrofit2.http.* <methods>; }
-keep,allowobfuscation interface <1>
-if interface * { @retrofit2.http.* <methods>; }
-keep,allowobfuscation interface * extends <1>

# R8 full mode strips generic signatures unless these stay
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response

-dontwarn retrofit2.KotlinExtensions
-dontwarn retrofit2.KotlinExtensions$*
-dontwarn javax.annotation.**
-dontwarn org.codehaus.mojo.animal_sniffer.IgnoreJRE
-dontwarn kotlin.Unit

# ── OkHttp / Okio ────────────────────────────────────────────────────────────
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ── WorkManager + Hilt workers (tour sync worker) ────────────────────────────
-keep class * extends androidx.work.ListenableWorker {
    <init>(...);
}
-keep @dagger.hilt.android.HiltAndroidApp class * { *; }

# ── Crash reports stay readable (mapping.txt still uploaded to Play) ─────────
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile
