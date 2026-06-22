package com.truehr.app.core

import com.truehr.app.domain.model.LatLngPoint
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/** Great-circle distance between two coordinates, in kilometres. */
fun haversineKm(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Double {
  val r = 6371.0
  fun rad(d: Double) = d * Math.PI / 180.0
  val dLat = rad(bLat - aLat)
  val dLng = rad(bLng - aLng)
  val s = sin(dLat / 2).let { it * it } +
    cos(rad(aLat)) * cos(rad(bLat)) * sin(dLng / 2).let { it * it }
  return 2 * r * asin(min(1.0, sqrt(s)))
}

/** Total path length of an ordered list of points, ignoring sub-5m jitter. */
fun pathDistanceKm(points: List<LatLngPoint>): Double {
  var total = 0.0
  for (i in 1 until points.size) {
    val d = haversineKm(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng)
    if (d >= 0.005) total += d
  }
  return total
}
