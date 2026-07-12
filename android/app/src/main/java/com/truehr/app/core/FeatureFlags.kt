package com.truehr.app.core

// Release switches. The NFA / PMS / vendor suite is fully built but hidden for
// this release — flip to true to expose it again (dashboard tiles + ESS hub).
object FeatureFlags {
  const val NFA_SUITE = true

  // "My ESS" dashboard tile (opens the web employee portal via SSO).
  // Independent of NFA_SUITE so the app release and the web portal can ship separately.
  const val MY_ESS = true
}
