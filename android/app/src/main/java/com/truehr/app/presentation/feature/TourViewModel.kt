package com.truehr.app.presentation.feature

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.truehr.app.core.UiState
import com.truehr.app.core.apiMessage
import com.truehr.app.domain.model.ActiveTour
import com.truehr.app.domain.model.Geotag
import com.truehr.app.domain.model.LatLngPoint
import com.truehr.app.domain.model.Tour
import com.truehr.app.domain.repository.TourRepository
import com.truehr.app.tracking.TourTrackingService
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class TourViewModel @Inject constructor(
  private val repo: TourRepository,
  @ApplicationContext private val app: Context,
) : ViewModel() {

  // ── Live tracking ──────────────────────────────────────────────────────────
  val activeTour = repo.activeTour()
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)
  val path = repo.activePath()
    .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList<LatLngPoint>())

  private val _status = MutableStateFlow<String?>(null)
  val status = _status.asStateFlow()

  fun startTour(lat: Double?, lng: Double?, address: String?) = viewModelScope.launch {
    val localId = repo.startTour(lat, lng, address)
    TourTrackingService.start(app, localId)
    _status.value = "Tour started — tracking your route."
  }

  fun endTour(active: ActiveTour, lat: Double?, lng: Double?, address: String?) = viewModelScope.launch {
    TourTrackingService.stop(app)
    repo.endTour(active.localId, lat, lng, address)
    _status.value = "Tour ended. It will sync when you're online."
  }

  // ── Geo Tag capture ─────────────────────────────────────────────────────────
  private val _geotagSaved = MutableStateFlow(false)
  val geotagSaved = _geotagSaved.asStateFlow()

  fun captureGeotag(lat: Double?, lng: Double?, address: String?, photoBase64: String, remark: String?) =
    viewModelScope.launch {
      repo.recordGeotag(lat, lng, address, photoBase64, remark)
      _geotagSaved.value = true
    }

  fun consumeGeotagSaved() { _geotagSaved.value = false }

  // ── Tour history (Tour Details) ──────────────────────────────────────────────
  val tours = MutableStateFlow(UiState<List<Tour>>())
  fun loadTours(from: String?, to: String?) = viewModelScope.launch {
    tours.value = tours.value.copy(loading = true, error = null)
    try { tours.value = UiState(data = repo.remoteTours(from, to)) }
    catch (e: Exception) { tours.value = UiState(error = e.apiMessage("Failed to load tours")) }
  }

  val detail = MutableStateFlow(UiState<Tour>())
  fun loadDetail(id: Long) = viewModelScope.launch {
    detail.value = detail.value.copy(loading = true, error = null)
    try { detail.value = UiState(data = repo.remoteTourDetail(id)) }
    catch (e: Exception) { detail.value = UiState(error = e.apiMessage("Failed to load tour")) }
  }

  // ── Geo Tag list ─────────────────────────────────────────────────────────────
  val geotags = MutableStateFlow(UiState<List<Geotag>>())
  fun loadGeotags(from: String?, to: String?) = viewModelScope.launch {
    geotags.value = geotags.value.copy(loading = true, error = null)
    try { geotags.value = UiState(data = repo.remoteGeotags(from, to)) }
    catch (e: Exception) { geotags.value = UiState(error = e.apiMessage("Failed to load geo-tags")) }
  }
}
