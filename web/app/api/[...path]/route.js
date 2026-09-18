// Runtime API proxy: forwards /api/* to the Express backend.
// Reads API_ORIGIN at request time, so it works both in Docker (http://backend:4000)
// and in local dev (defaults to http://localhost:4000).
export const dynamic = 'force-dynamic';

const API_ORIGIN = () => process.env.API_ORIGIN || 'http://localhost:4000';

async function proxy(request, { params }) {
  const path = (params.path || []).join('/');
  const target = `${API_ORIGIN()}/api/${path}${request.nextUrl.search}`;

  const headers = {};
  const ct = request.headers.get('content-type');
  const auth = request.headers.get('authorization');
  if (ct) headers['content-type'] = ct;
  if (auth) headers['authorization'] = auth;

  const init = { method: request.method, headers, redirect: 'manual' };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.text();
  }

  let resp;
  try {
    resp = await fetch(target, init);
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Backend is unreachable. Is the API running?' }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }

  // Forward the headers a download actually needs. Rebuilding the response with
  // content-type alone dropped Content-Disposition, so payslip PDFs and Excel
  // exports arrived with no filename — and, now that attachments are served as
  // downloads, without the header that makes them download at all.
  const out = new Headers();
  for (const h of ['content-type', 'content-disposition', 'content-length',
    'x-content-type-options', 'cache-control']) {
    const v = resp.headers.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has('content-type')) out.set('content-type', 'application/json');
  // Stream it through rather than await resp.arrayBuffer(): a large export was
  // held whole in this process's memory before a byte reached the browser.
  return new Response(resp.body, { status: resp.status, headers: out });
}

export {
  proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS,
};
