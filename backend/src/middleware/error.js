export function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}
export function errorHandler(err, req, res, next) { // eslint-disable-line
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({ error: err.publicMessage || 'Internal server error' });
}
export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.publicMessage = message;
  }
}
