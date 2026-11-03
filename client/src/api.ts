export async function api(path: string, body?: unknown, method?: string) {
  const r = await fetch(`/api${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionStorage.getItem('swizton-token') ?? ''}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 401 && path !== '/auth/login') {
      sessionStorage.removeItem('swizton-token');
      window.dispatchEvent(new Event('swizton-session-expired'));
    }
    throw Error(data.error ?? 'Request failed');
  }
  return data;
}
export async function download(path: string, name: string) {
  const r = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${sessionStorage.getItem('swizton-token') ?? ''}` },
  });
  if (!r.ok) throw Error((await r.json()).error);
  const u = URL.createObjectURL(await r.blob()),
    a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 10000);
}
