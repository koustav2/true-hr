package com.truehr.app.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import retrofit2.HttpException
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/**
 * A server error as the v2 API sends it: `{ error, fields: { key: message } }`.
 * [message] is always something a person can read — never "HTTP 400".
 */
data class ApiError(
  val message: String,
  val fields: Map<String, String> = emptyMap(),
  val status: Int? = null,
) {
  /** Message for one field, or null. */
  fun field(key: String): String? = fields[key]

  /**
   * The message to show above a form. When every problem is shown next to its
   * own field, a single summary line is enough; otherwise the server's text.
   */
  fun summary(shownFields: Set<String> = emptySet()): String {
    val unshown = fields.filterKeys { it !in shownFields }
    return when {
      fields.isEmpty() -> message
      unshown.isEmpty() -> if (fields.size == 1) fields.values.first() else "Please fix the highlighted fields."
      unshown.size == 1 && fields.size == 1 -> unshown.values.first()
      else -> unshown.values.joinToString("\n")
    }
  }
}

private val errorJson = Json { ignoreUnknownKeys = true; isLenient = true }

/** Fallback wording per HTTP status when the body carries no readable message. */
fun statusMessage(code: Int): String = when (code) {
  400 -> "Please check the details and try again."
  401 -> "Your session has expired. Please sign in again."
  403 -> "You don't have permission to do this."
  404 -> "We couldn't find that. It may have been removed."
  408 -> "The server took too long to respond. Please try again."
  409 -> "This conflicts with an existing record."
  413 -> "That file is too large."
  429 -> "Too many attempts. Please wait a minute and try again."
  in 500..599 -> "The server had a problem. Please try again in a moment."
  else -> "Something went wrong. Please try again."
}

/**
 * Parses an error body. Pure function (no Android types) so it is unit-tested.
 * Accepts `{error}`, `{message}`, `{error, fields}` and non-JSON bodies.
 */
fun parseApiError(body: String?, code: Int?): ApiError {
  val fallback = code?.let { statusMessage(it) } ?: "Something went wrong. Please try again."
  if (body.isNullOrBlank()) return ApiError(fallback, emptyMap(), code)
  val obj: JsonObject = runCatching { errorJson.parseToJsonElement(body).jsonObject }.getOrNull()
    ?: return ApiError(fallback, emptyMap(), code)
  val fields = runCatching {
    (obj["fields"] as? JsonObject)?.mapNotNull { (k, v) ->
      val msg = (v as? JsonPrimitive)?.contentOrNull?.trim()
      if (msg.isNullOrEmpty()) null else k to msg
    }?.toMap()
  }.getOrNull().orEmpty()
  val raw = listOf("error", "message").firstNotNullOfOrNull { k ->
    (obj[k] as? JsonPrimitive)?.contentOrNull?.trim()?.takeIf { it.isNotEmpty() }
  }
  // "_form" is a whole-form message (e.g. "Nothing has changed").
  val message = fields["_form"] ?: raw ?: fields.values.firstOrNull() ?: fallback
  return ApiError(message, fields - "_form", code)
}

/** Reads the error body without consuming it, so it can be read again later. */
private fun HttpException.peekBody(): String? = runCatching {
  val body = response()?.errorBody() ?: return null
  val source = body.source()
  source.request(Long.MAX_VALUE)
  source.buffer.clone().readUtf8()
}.getOrNull()

/** Structured error for any failure: server message + per-field messages. */
fun Throwable.apiError(fallback: String = "Something went wrong. Please try again."): ApiError = when (this) {
  is HttpException -> parseApiError(peekBody(), code())
  is ConnectException, is UnknownHostException -> ApiError("Can't reach the server. Check your internet connection.")
  is SocketTimeoutException -> ApiError("The server took too long to respond. Please try again.")
  is IOException -> ApiError("Network problem. Check your internet connection and try again.")
  is kotlinx.serialization.SerializationException -> ApiError("The server sent something this app version can't read. Please update the app.")
  else -> ApiError(message?.takeIf { it.isNotBlank() && !it.startsWith("HTTP ") } ?: fallback)
}

/** Human-friendly message for network/HTTP errors (the server's own words when it sent any). */
fun Throwable.apiMessage(fallback: String = "Something went wrong. Please try again."): String =
  apiError(fallback).message
