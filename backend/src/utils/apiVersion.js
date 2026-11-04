// Which API generation a request came in on. /api/v2 is the web portal from the
// QA fix pass onward; /api (v1) is every client already in the field, notably the
// Android app, and must keep its old contract. Security and data-integrity fixes
// apply to both; stricter validation and changed response shapes are v2 only.
export const isV2 = (req) => req.apiVersion === 2;

export function markVersion(version) {
  return (req, res, next) => { if (!req.apiVersion) req.apiVersion = version; next(); };
}
