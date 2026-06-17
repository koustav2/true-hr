package com.truehr.app.core

/** Wraps the outcome of a data operation. */
sealed interface Resource<out T> {
  data object Loading : Resource<Nothing>
  data class Success<T>(val data: T) : Resource<T>
  data class Error(val message: String) : Resource<Nothing>
}
