package com.truehr.app

import com.truehr.app.data.remote.dto.FullProfileDto
import com.truehr.app.di.AppJson
import com.truehr.app.presentation.profile.ChangeRequestForm
import kotlinx.serialization.decodeFromString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ChangeRequestFormTest {
  private val me: FullProfileDto = AppJson.decodeFromString(javaClass.classLoader!!.getResource("v2/emp_me_full-profile.json")!!.readText())

  @Test fun prefilledFromTheRecord() {
    val addr = ChangeRequestForm.base("ADDRESS", me, "CURRENT")
    assertEquals("Bengaluru", addr["city"]); assertEquals("Karnataka", addr["state"]); assertEquals("560103", addr["pincode"])
    val bank = ChangeRequestForm.base("BANK", me)
    assertEquals("Sneha Iyer", bank["accountHolder"]); assertEquals("ICICI Bank", bank["bankName"]); assertEquals("ICIC0004321", bank["ifsc"])
    assertEquals("", bank["accountNumber"])
  }

  @Test fun unchangedFormCreatesNoRequest() {
    val base = ChangeRequestForm.base("BANK", me)
    assertNull(ChangeRequestForm.payload("BANK", base, base, "CURRENT"))
  }

  @Test fun addressPayloadCarriesTheType() {
    val base = ChangeRequestForm.base("ADDRESS", me, "PERMANENT")
    val p = ChangeRequestForm.payload("ADDRESS", base + ("pincode" to "560001"), base, "PERMANENT")
    assertEquals(mapOf("pincode" to "560001", "type" to "PERMANENT"), p)
  }

  @Test fun readableValues() {
    assertEquals("Male", ChangeRequestForm.show("gender", "MALE"))
    assertEquals("••••1234", ChangeRequestForm.show("accountNumber", "00001234"))
    assertEquals("01-01-1995", ChangeRequestForm.show("dob", "1995-01-01"))
  }
}
