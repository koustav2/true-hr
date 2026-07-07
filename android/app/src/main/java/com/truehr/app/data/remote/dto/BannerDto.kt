package com.truehr.app.data.remote.dto

import kotlinx.serialization.Serializable

/** Dashboard carousel banner uploaded by HR from the admin portal. The image itself
 *  is fetched from `banners/{id}/image` (auth-protected; Coil's app-wide loader
 *  already carries the bearer token). */
@Serializable
data class BannerDto(
  val id: Long,
  val mime: String? = null,
  val filename: String? = null,
  val sortOrder: Int = 0,
)
