package com.truehr.app.core

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface

/** Burn a multi-line caption (name, code, time, address, coords, remark) onto the
 *  bottom of a captured photo — the way the Geo Tag List entries appear. */
fun stampGeotag(src: Bitmap, lines: List<String>): Bitmap {
  val bmp = src.copy(Bitmap.Config.ARGB_8888, true)
  val canvas = Canvas(bmp)
  val pad = bmp.width * 0.02f
  val textSize = (bmp.width * 0.032f).coerceAtLeast(20f)
  val lineH = textSize * 1.25f
  val text = Paint().apply {
    color = Color.WHITE; this.textSize = textSize; isAntiAlias = true
    typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
  }
  val bg = Paint().apply { color = Color.argb(140, 0, 0, 0) }
  val boxH = lineH * lines.size + pad * 2
  canvas.drawRect(0f, bmp.height - boxH, bmp.width.toFloat(), bmp.height.toFloat(), bg)
  var y = bmp.height - boxH + pad + textSize
  for (l in lines) { canvas.drawText(l, pad, y, text); y += lineH }
  return bmp
}
