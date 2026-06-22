package com.truehr.app.tracking

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.truehr.app.domain.repository.TourRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

// Uploads everything buffered locally (offline-created tours, path points, ended tours,
// geo-tags) when the network is available. Retries on failure with backoff.
@HiltWorker
class TourSyncWorker @AssistedInject constructor(
  @Assisted appContext: Context,
  @Assisted params: WorkerParameters,
  private val repo: TourRepository,
) : CoroutineWorker(appContext, params) {

  override suspend fun doWork(): Result =
    if (repo.syncNow()) Result.success() else Result.retry()
}
