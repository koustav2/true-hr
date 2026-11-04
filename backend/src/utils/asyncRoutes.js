// Express 4 does not catch a rejected promise from an async handler: the
// rejection escapes, and on Node 20+ an unhandled rejection kills the process.
// Several controllers have no try/catch, so one bad input restarted the API.
// Wrapping every handler registered on a router sends those errors to next().
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

const wrap = (fn) => {
  if (typeof fn !== 'function' || fn.length === 4) return fn;  // error middleware: leave alone
  if (fn.handle && fn.stack) return fn;                         // a nested Router
  return function wrapped(req, res, next) {
    try {
      const out = fn(req, res, next);
      if (out && typeof out.catch === 'function') out.catch(next);
      return out;
    } catch (e) { return next(e); }
  };
};

export function catchAsync(router) {
  for (const m of METHODS) {
    const orig = router[m].bind(router);
    router[m] = (...args) => orig(...args.map((a) => (Array.isArray(a) ? a.map(wrap) : wrap(a))));
  }
  return router;
}
