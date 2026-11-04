package com.truehr.app

import com.truehr.app.data.DeviceTokenUnregistrar
import com.truehr.app.data.LocalBufferStore
import com.truehr.app.data.SessionCleaner
import com.truehr.app.data.SyncPolicy
import com.truehr.app.data.local.SessionStore
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class SessionCleanerTest {
  private val log = mutableListOf<String>()

  private inner class FakeSession(var token: String? = "tok") : SessionStore {
    override suspend fun current() = token
    override suspend fun userId() = "9"
    override suspend fun clear() { log += "session.clear(token=${token != null})"; token = null }
  }
  private inner class FakePush(val fail: Boolean = false) : DeviceTokenUnregistrar {
    override suspend fun unregister(): Boolean { log += "push.unregister"; if (fail) throw RuntimeException("offline"); return true }
  }
  private inner class FakeBuffer(val failFlush: Boolean = false) : LocalBufferStore {
    val rows = mutableListOf("tour of user 9", "geotag of user 9")
    override suspend fun flush() { log += "buffer.flush"; if (failFlush) throw RuntimeException("offline") }
    override suspend fun clearAll() { log += "buffer.clearAll"; rows.clear() }
    override suspend fun keepOnly(userId: String) { log += "buffer.keepOnly($userId)" }
  }

  @Test fun signOutClearsEverythingInOrder() = runBlocking {
    val buffer = FakeBuffer(); val session = FakeSession()
    val r = SessionCleaner(FakePush(), buffer, session).signOut()
    // Push token is unregistered while the session token is still valid; Room is wiped before the session.
    assertEquals(listOf("buffer.flush", "push.unregister", "buffer.clearAll", "session.clear(token=true)"), log)
    assertTrue(buffer.rows.isEmpty())
    assertNull(session.token)
    assertTrue(r.flushed && r.pushUnregistered && r.bufferCleared)
  }

  @Test fun failuresNeverSkipTheClearing() = runBlocking {
    val buffer = FakeBuffer(failFlush = true); val session = FakeSession()
    val r = SessionCleaner(FakePush(fail = true), buffer, session).signOut()
    assertTrue(buffer.rows.isEmpty())
    assertNull(session.token)
    assertFalse(r.pushUnregistered)
    assertFalse(r.flushed)
  }

  @Test fun alreadySignedOutStillWipesBuffer() = runBlocking {
    val buffer = FakeBuffer(); val session = FakeSession(token = null)
    SessionCleaner(FakePush(), buffer, session).signOut()
    assertFalse("no unregister without a session", log.contains("push.unregister"))
    assertTrue(buffer.rows.isEmpty())
  }

  @Test fun adoptDropsOtherAccountsRows() = runBlocking {
    SessionCleaner(FakePush(), FakeBuffer(), FakeSession()).adopt("12")
    assertEquals(listOf("buffer.keepOnly(12)"), log)
  }

  @Test fun syncPolicyParksOnlyPermanentFailures() {
    fun http(c: Int) = HttpException(Response.error<Any>(c, "{}".toResponseBody("application/json".toMediaType())))
    assertTrue(SyncPolicy.isPermanent(http(400)))
    assertTrue(SyncPolicy.isPermanent(http(404)))
    assertTrue(SyncPolicy.isPermanent(http(409)))
    assertFalse(SyncPolicy.isPermanent(http(401)))
    assertFalse(SyncPolicy.isPermanent(http(429)))
    assertFalse(SyncPolicy.isPermanent(http(500)))
    assertFalse(SyncPolicy.isPermanent(java.io.IOException("offline")))
  }
}
