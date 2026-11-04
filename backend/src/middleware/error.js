export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}
export function errorHandler(err, req, res, next) { // eslint-disable-line
  // A malformed JSON body is the client's fault, not a 500.
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large' });
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  const body = { error: err.publicMessage || 'Internal server error' };
  if (err.fields) body.fields = err.fields;   // v2: every field error at once
  res.status(status).json(body);
}
export class AppError extends Error {
  constructor(message, status = 400, fields) {
    super(message);
    this.status = status;
    this.publicMessage = message;
    if (fields) this.fields = fields;
  }
}
