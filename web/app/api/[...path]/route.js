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

  const body = await resp.arrayBuffer();
  return new Response(body, {
    status: resp.status,
    headers: { 'content-type': resp.headers.get('content-type') || 'application/json' },
  });
}

export {
  proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS,
};
