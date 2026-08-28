// A short-lived cache in front of GitHub, with concurrent calls collapsed.
//
// This exists because of arithmetic. The board reads two endpoints per
// repository — open issues and branches — and the organisation has thirteen. So
// one page load costs twenty-six requests, and /team and /analytics read the
// same things again. GitHub allows five thousand an hour for the whole
// installation. A team of eleven with the board open, refreshing every couple
// of minutes, spends more than eight thousand: the limit is gone before
// lunchtime, and when it goes every screen fails at once for an hour.
//
// Two mechanisms, and the second matters more than it looks:
//
//   A TTL. Thirty seconds by default — long enough that a refresh, a colleague
//   loading /team and the analytics page share one read, short enough that a
//   task somebody just took shows up almost immediately. This is a tool people
//   watch; a minute of staleness would be felt.
//
//   Single flight. Concurrent callers asking for the same key wait on one
//   request rather than each making their own. Without it, three people opening
//   the board in the same second still cost seventy-eight requests — the TTL
//   alone does nothing for the burst it was meant to absorb.
//
// The cache is per instance and dies with it, which on serverless means it is a
// reduction rather than a guarantee. That is fine: the failure it prevents is
// sustained load from a working team, not a cold start.
//
// Nothing user-scoped goes in here. Every key is a repository read that is the
// same for everybody — putting a person's data behind a shared key is how one
// colleague ends up looking at another's page.

type Entry<T> = { at: number; value: T };

const DEFAULT_TTL_MS = 30_000;

const done = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Run `fn` at most once per `key` per `ttlMs`, and only once at a time.
 *
 * A rejection is never cached. Caching a failure would turn one bad minute at
 * GitHub into thirty seconds of a board that says nothing is open — and the
 * whole point of this codebase is that an empty screen has to mean something.
 */
export async function cached<T>(key: string, fn: () => Promise<T>, ttlMs = DEFAULT_TTL_MS): Promise<T> {
  const hit = done.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const p = (async () => {
    try {
      const value = await fn();
      done.set(key, { at: Date.now(), value });
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

/** Drop a key, or everything. Used after a write, so the next read is truthful. */
export function invalidate(prefix?: string): void {
  if (!prefix) { done.clear(); return; }
  for (const k of done.keys()) if (k.startsWith(prefix)) done.delete(k);
}

/** What the cache is holding. Reported by /api/health, not used for decisions. */
export const cacheSize = () => done.size;
