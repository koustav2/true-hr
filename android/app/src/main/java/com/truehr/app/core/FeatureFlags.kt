package com.truehr.app.core

// Release switches. The NFA / PMS / vendor suite is fully built but hidden for
// this release — flip to true to expose it again (dashboard tiles + ESS hub).
object FeatureFlags {
  const val NFA_SUITE = false
}
