import { describe, expect, it } from 'vitest';
import { checkForUpdate, isNewerVersion } from '../src/index.js';

/**
 * The update check never reaches the network here: every case supplies its own
 * `fetch`. A test that depended on a published release would fail on the day
 * someone cut one.
 */
function respondWith(body: unknown, status = 200): typeof globalThis.fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as typeof globalThis.fetch;
}

const URL = 'https://example.invalid/releases/latest';

describe('comparing versions', () => {
  it('orders by each number in turn, not as text', () => {
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true);
    expect(isNewerVersion('0.9.0', '0.10.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.2.1', '0.2.0')).toBe(true);
  });

  it('treats the release tag and the manifest version as the same number', () => {
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewerVersion('v0.1.0', '0.1.0')).toBe(false);
  });

  it('does not consider a pre-release newer than the release it precedes', () => {
    expect(isNewerVersion('0.2.0-rc.1', '0.2.0')).toBe(false);
  });

  it('refuses to guess at something that is not a version', () => {
    expect(isNewerVersion('latest', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.2.0', 'unknown')).toBe(false);
  });
});

describe('checking for an update', () => {
  it('reports a newer published release', async () => {
    const status = await checkForUpdate({
      currentVersion: '0.1.0',
      url: URL,
      fetch: respondWith({
        tag_name: 'v0.2.0',
        html_url: 'https://example.invalid/releases/v0.2.0',
        published_at: '2026-09-06T00:00:00Z',
      }),
    });

    expect(status.updateAvailable).toBe(true);
    expect(status.latestVersion).toBe('0.2.0');
    expect(status.downloadUrl).toBe('https://example.invalid/releases/v0.2.0');
    expect(status.problem).toBeNull();
  });

  it('reports the running version as current when it matches the release', async () => {
    const status = await checkForUpdate({
      currentVersion: '0.2.0',
      url: URL,
      fetch: respondWith({ tag_name: 'v0.2.0' }),
    });

    expect(status.updateAvailable).toBe(false);
    expect(status.problem).toBeNull();
  });

  it('never offers to downgrade a build newer than the last release', async () => {
    const status = await checkForUpdate({
      currentVersion: '0.3.0',
      url: URL,
      fetch: respondWith({ tag_name: 'v0.2.0' }),
    });

    expect(status.updateAvailable).toBe(false);
  });

  it('treats no release at all as nothing to update to', async () => {
    const status = await checkForUpdate({
      currentVersion: '0.1.0',
      url: URL,
      fetch: respondWith({ message: 'Not Found' }, 404),
    });

    expect(status.updateAvailable).toBe(false);
    expect(status.latestVersion).toBeNull();
    // Not a problem to report: there simply is no newer version.
    expect(status.problem).toBeNull();
  });

  it('ignores a draft or a pre-release rather than offering it', async () => {
    for (const release of [
      { tag_name: 'v0.9.0', draft: true },
      { tag_name: 'v0.9.0', prerelease: true },
    ]) {
      const status = await checkForUpdate({
        currentVersion: '0.1.0',
        url: URL,
        fetch: respondWith(release),
      });

      expect(status.updateAvailable).toBe(false);
      expect(status.problem).not.toBeNull();
    }
  });

  it('says it could not reach the internet, without failing', async () => {
    const status = await checkForUpdate({
      currentVersion: '0.1.0',
      url: URL,
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof globalThis.fetch,
    });

    // Offline is the expected state of a library computer, so the check
    // answers rather than throwing, and says so in Hebrew.
    expect(status.problem).toContain('אינטרנט');
    expect(status.updateAvailable).toBe(false);
    expect(status.currentVersion).toBe('0.1.0');
  });

  it('gives up rather than hanging when nothing answers', async () => {
    const status = await checkForUpdate({
      currentVersion: '0.1.0',
      url: URL,
      timeoutMs: 20,
      fetch: ((_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })) as unknown as typeof globalThis.fetch,
    });

    expect(status.problem).toContain('זמן');
    expect(status.updateAvailable).toBe(false);
  });

  it('reports a server error as a failed check rather than as no update', async () => {
    const status = await checkForUpdate({
      currentVersion: '0.1.0',
      url: URL,
      fetch: respondWith({}, 503),
    });

    expect(status.problem).toContain('503');
    expect(status.updateAvailable).toBe(false);
  });

  it('refuses a release whose tag is not a version', async () => {
    const status = await checkForUpdate({
      currentVersion: '0.1.0',
      url: URL,
      fetch: respondWith({ tag_name: 'nightly' }),
    });

    expect(status.updateAvailable).toBe(false);
    expect(status.problem).not.toBeNull();
  });
});
