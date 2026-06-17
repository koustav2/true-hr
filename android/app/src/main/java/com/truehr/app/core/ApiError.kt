package com.truehr.app.core

import retrofit2.HttpException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Human-friendly message for network/HTTP errors, extracting the backend's {"error":...}. */
fun Throwable.apiMessage(fallback: String = "Something went wrong"): String = when (this) {
  is HttpException -> {
    val body = runCatching { response()?.errorBody()?.string() }.getOrNull()
    val match = body?.let { Regex("\"error\"\\s*:\\s*\"([^\"]+)\"").find(it)?.groupValues?.getOrNull(1) }
    match ?: "Request failed (${code()})"
  }
  is ConnectException, is UnknownHostException, is SocketTimeoutException ->
    "Can't reach the server. Check your connection."
  else -> message ?: fallback
}
