// Small shared helpers: fetch wrapper, query-string builder, debounce.

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: opts.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { data, status: res.status });
  return data;
}

function qs(params) {
  const p = Object.entries(params).filter(([, v]) => v !== '' && v != null);
  return p.length ? '?' + new URLSearchParams(p).toString() : '';
}

function debounce(fn, ms) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}
