# Keep kotlinx.serialization metadata
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class **$$serializer { *; }
-keep,includedescriptorclasses class com.truehr.app.**$$serializer { *; }
-keepclassmembers class com.truehr.app.** { *** Companion; }
