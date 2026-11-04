package com.truehr.app.presentation.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.Dates
import com.truehr.app.core.UiState
import com.truehr.app.core.Validators
import com.truehr.app.core.apiError
import com.truehr.app.core.apiMessage
import com.truehr.app.data.remote.ApiService
import com.truehr.app.data.remote.dto.ChangeRequestBody
import com.truehr.app.data.remote.dto.ChangeRequestDto
import com.truehr.app.data.remote.dto.ChangeRequestEdit
import com.truehr.app.data.remote.dto.FullProfileDto
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import javax.inject.Inject

/** Field order and labels per kind (same as web/app/ess/change-request). */
object ChangeRequestForm {
  val FIELDS = mapOf(
    "PROFILE" to listOf("phone", "personalEmail", "dob", "gender"),
    "ADDRESS" to listOf("line1", "line2", "city", "district", "state", "pincode", "country"),
    "BANK" to listOf("accountHolder", "bankName", "branch", "ifsc", "accountNumber"),
  )
  val LABEL = mapOf(
    "phone" to "Phone", "personalEmail" to "Personal email", "dob" to "Date of birth", "gender" to "Gender",
    "type" to "Address type", "line1" to "Address line 1", "line2" to "Address line 2", "city" to "City", "district" to "District",
    "state" to "State", "pincode" to "PIN code", "country" to "Country",
    "accountHolder" to "Account holder", "bankName" to "Bank", "branch" to "Branch", "ifsc" to "IFSC", "accountNumber" to "Account number",
  )

  /** E58/E60: start from what HR holds, so only real changes are sent. */
  fun base(kind: String, me: FullProfileDto, addressType: String = "CURRENT"): Map<String, String> = when (kind) {
    "PROFILE" -> mapOf(
      "phone" to me.phone.orEmpty(), "personalEmail" to me.personalEmail.orEmpty(),
      "dob" to (Dates.isoDay(me.dob) ?: ""), "gender" to me.gender.orEmpty().uppercase(),
    )
    "ADDRESS" -> {
      val a = me.addresses.firstOrNull { it.type == addressType }
      mapOf(
        "line1" to a?.line1.orEmpty(), "line2" to a?.line2.orEmpty(), "city" to a?.city.orEmpty(),
        "district" to a?.district.orEmpty(),
        "state" to (Validators.INDIAN_STATES.firstOrNull { it.equals(a?.state?.trim(), true) } ?: ""),
        "pincode" to a?.pincode.orEmpty(), "country" to (a?.country ?: "India"),
      )
    }
    else -> mapOf(
      "accountHolder" to me.bank.accountHolder.orEmpty(), "bankName" to me.bank.bankName.orEmpty(),
      "branch" to me.bank.branch.orEmpty(), "ifsc" to me.bank.ifsc.orEmpty(),
      // The number itself is never shown; leave blank to keep it.
      "accountNumber" to "",
    )
  }

  /** Readable value for the history list (never MALE / CURRENT, account number masked). */
  fun show(key: String, value: String?): String = when {
    value.isNullOrBlank() -> "—"
    key == "dob" -> Dates.dmy(value)
    key == "gender" || key == "type" -> com.truehr.app.core.Labels.of(value)
    key == "accountNumber" -> "••••" + value.takeLast(4)
    else -> value
  }

  /** Builds the payload: changed fields only (+ address type), or null when nothing changed. */
  fun payload(kind: String, form: Map<String, String>, base: Map<String, String>, addressType: String): Map<String, String>? {
    val changed = Validators.changedFields(form, base).toMutableMap()
    if (changed.isEmpty()) return null
    if (kind == "ADDRESS") changed["type"] = addressType
    if (kind == "BANK" && changed["ifsc"] != null) changed["ifsc"] = changed["ifsc"]!!.uppercase()
    return changed
  }
}

data class ChangeRequestItem(val id: Long, val kind: String, val status: String, val submittedAt: String?, val reviewNote: String?, val payload: Map<String, String>)

@HiltViewModel
class ChangeRequestViewModel @Inject constructor(private val api: ApiService) : ViewModel() {
  val profile = MutableStateFlow(UiState<FullProfileDto>(loading = true))
  val history = MutableStateFlow<List<ChangeRequestItem>>(emptyList())
  val busy = MutableStateFlow(false)
  val fieldErrors = MutableStateFlow<Map<String, String>>(emptyMap())
  val message = MutableStateFlow<String?>(null)
  val success = MutableStateFlow<String?>(null)

  init { load() }

  fun load() = viewModelScope.launch {
    try { profile.value = UiState(data = api.fullProfile()) }
    catch (e: Exception) { profile.value = UiState(error = e.apiMessage("Couldn't load your record")) }
    loadHistory()
  }

  private suspend fun loadHistory() {
    try { history.value = api.myChangeRequests().map { it.toItem() } }
    catch (e: Exception) { message.value = e.apiMessage("Couldn't load your requests") }
  }

  fun clearFieldError(k: String) { fieldErrors.value = fieldErrors.value - k; message.value = null }

  /** E59-E61: validate the changed fields, then send (or update the pending one). */
  fun submit(kind: String, form: Map<String, String>, base: Map<String, String>, addressType: String, editingId: Long?) = viewModelScope.launch {
    success.value = null
    val payload = ChangeRequestForm.payload(kind, form, base, addressType)
    if (payload == null) { fieldErrors.value = emptyMap(); message.value = Validators.NOTHING_CHANGED; return@launch }
    val errs = Validators.changeRequest(kind, payload, Dates.todayIso())
    fieldErrors.value = errs
    if (errs.isNotEmpty()) { message.value = null; return@launch }
    busy.value = true; message.value = null
    try {
      if (editingId != null) api.editChangeRequest(editingId, ChangeRequestEdit(payload))
      else api.submitChangeRequest(ChangeRequestBody(kind, payload))
      success.value = if (editingId != null) "Your pending request was updated." else "Sent to HR. You will see it below as Approved or Rejected once reviewed."
      loadHistory()
    } catch (e: Exception) {
      val err = e.apiError("Could not send the request")
      fieldErrors.value = err.fields
      message.value = err.message
    } finally { busy.value = false }
  }

  fun withdraw(id: Long) = viewModelScope.launch {
    busy.value = true; message.value = null; success.value = null
    try { api.withdrawChangeRequest(id); success.value = "Request withdrawn."; loadHistory() }
    catch (e: Exception) { message.value = e.apiMessage("Could not withdraw the request") }
    finally { busy.value = false }
  }
}

internal fun ChangeRequestDto.toItem() = ChangeRequestItem(
  id = id, kind = kind, status = status.orEmpty(), submittedAt = submittedAt, reviewNote = reviewNote,
  payload = payload.mapValues { (it.value as? JsonPrimitive)?.contentOrNull.orEmpty() },
)
