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

/** A file picked by the user, ready to upload as base64. */
data class PickedFile(val base64: String, val mime: String, val name: String, val sizeKb: Int)

private val UPLOAD_MIMES = setOf("application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif")

/**
 * Reads a picked file off the main thread. Only PDF/PNG/JPG/WEBP/GIF up to [maxMb]
 * (the server checks the same and the real content type). Returns the file or a
 * readable error message.
 */
suspend fun readPickedFile(context: Context, uri: android.net.Uri, maxMb: Int = 5): Result<PickedFile> = withContext(Dispatchers.IO) {
  runCatching {
    val cr = context.contentResolver
    val mime = cr.getType(uri) ?: "application/octet-stream"
    if (mime !in UPLOAD_MIMES) error("The file must be a PDF, PNG, JPG, WEBP or GIF")
    val name = cr.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) c.getString(0) else null
    } ?: "attachment"
    val bytes = cr.openInputStream(uri)?.use { it.readBytes() } ?: error("Could not read the file")
    if (bytes.size > maxMb * 1024 * 1024) error("The file is larger than ${maxMb}MB")
    PickedFile(Base64.encodeToString(bytes, Base64.NO_WRAP), mime, name, bytes.size / 1024)
  }
}
