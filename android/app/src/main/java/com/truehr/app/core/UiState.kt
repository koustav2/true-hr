package com.truehr.app.core

/** Generic screen state used by ViewModels. */
data class UiState<T>(
  val loading: Boolean = false,
  val data: T? = null,
  val error: String? = null,
)
