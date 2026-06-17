package com.truehr.app.core

import android.content.Context
import android.graphics.Bitmap
import android.location.Geocoder
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.util.Locale

/** JPEG-compress a bitmap and return a data-URL-free base64 string. */
fun Bitmap.toJpegBase64(quality: Int = 60): String {
  val out = ByteArrayOutputStream()
  compress(Bitmap.CompressFormat.JPEG, quality, out)
  return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
}

/** Best-effort reverse geocoding; returns a readable address or null. */
suspend fun reverseGeocode(context: Context, lat: Double, lng: Double): String? = withContext(Dispatchers.IO) {
  runCatching {
    @Suppress("DEPRECATION")
    val results = Geocoder(context, Locale.getDefault()).getFromLocation(lat, lng, 1)
    results?.firstOrNull()?.getAddressLine(0)
  }.getOrNull()
}
