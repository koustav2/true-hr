package com.truehr.app

import com.truehr.app.core.apiError
import com.truehr.app.core.apiMessage
import com.truehr.app.core.parseApiError
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class ApiErrorTest {
  private fun http(code: Int, body: String) =
    HttpException(Response.error<Any>(code, body.toResponseBody("application/json".toMediaType())))

  @Test fun v2FieldsAreParsed() {
    val body = javaClass.classLoader!!.getResource("v2/err_leave_halfday.json")!!.readText()
    val e = parseApiError(body, 400)
    assertEquals("Reason is required", e.field("reason"))
    assertEquals("Half day is allowed only when From and To are the same date", e.field("halfDay"))
    assertEquals("Choose First half or Second half", e.field("halfDaySession"))
    assertTrue(e.message.startsWith("Please fix 3 fields"))
    // Every field shown next to its input → a short summary line.
    assertEquals("Please fix the highlighted fields.", e.summary(setOf("reason", "halfDay", "halfDaySession")))
  }

  @Test fun singleErrorWithoutFields() {
    val e = parseApiError("""{"error":"Invalid credentials"}""", 401)
    assertEquals("Invalid credentials", e.message)
    assertTrue(e.fields.isEmpty())
    assertEquals(401, e.status)
  }

  @Test fun formLevelMessageWins() {
    val e = parseApiError("""{"error":"Nothing has changed — edit at least one field before sending.","fields":{"_form":"Nothing has changed — edit at least one field before sending."}}""", 400)
    assertEquals("Nothing has changed — edit at least one field before sending.", e.message)
    assertFalse(e.fields.containsKey("_form"))
  }

  @Test fun nonJsonBodyNeverShowsHttpCode() {
    val e = parseApiError("<html>Bad gateway</html>", 502)
    assertEquals("The server had a problem. Please try again in a moment.", e.message)
    assertFalse(e.message.contains("502"))
    assertEquals("Please check the details and try again.", parseApiError(null, 400).message)
  }

  @Test fun httpExceptionUsesServerMessageAndCanBeReadTwice() {
    val ex = http(409, """{"error":"You already have a miss-punch request for 05-12-2026","fields":{"days":"Already requested: 05-12-2026"}}""")
    assertEquals("You already have a miss-punch request for 05-12-2026", ex.apiMessage())
    // Second read (e.g. message + fields) still works: the body is peeked, not consumed.
    assertEquals("Already requested: 05-12-2026", ex.apiError().field("days"))
  }

  @Test fun networkErrorsAreReadable() {
    assertEquals("Can't reach the server. Check your internet connection.", java.net.UnknownHostException("x").apiMessage())
    assertEquals("The server took too long to respond. Please try again.", java.net.SocketTimeoutException().apiMessage())
  }
}
