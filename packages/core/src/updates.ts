import { APP_VERSION } from './version.js';

/**
 * Is there a newer version of the application?
 *
 * PRODUCT_SPEC.md §2 asks for a button that updates the program. This is the
 * half that answers whether there is anything to update to. The library
 * computer decides when to ask and a person decides whether to install — an
 * update that arrives on its own is an update that arrives in the middle of a
 * queue of children waiting to borrow books.
 *
 * The published releases are the source of truth. Nothing else has to be
 * maintained in step: the release tag and the version in the application are
 * the same number by construction, because both come from the workspace
 * `package.json`.
 */

const DEFAULT_RELEASES_URL = 'https://api.github.com/repos/ayg770/school-library/releases/latest';

/**
 * Where releases are published.
 *
 * `LIBRARY_RELEASES_URL` redirects the check — used by tests so they never
 * reach the network, and by anyone running their own copy of this application
 * from their own repository.
 */
function releasesUrl(): string {
  return process.env.LIBRARY_RELEASES_URL?.trim() || DEFAULT_RELEASES_URL;
}

export interface UpdateStatus {
  readonly currentVersion: string;
  /** The published version, or null when it could not be determined. */
  readonly latestVersion: string | null;
  readonly updateAvailable: boolean;
  /** The page a person is sent to in order to install it. */
  readonly downloadUrl: string | null;
  readonly publishedAt: string | null;
  /**
   * Why the check could not answer, in Hebrew, or null when it did.
   *
   * Being offline is the expected case on this machine, not a fault: §1 and
   * AD-8 have the library working without a connection. So it is reported as a
   * plain statement rather than an error.
   */
  readonly problem: string | null;
}

/** A release as the GitHub API returns it — only the fields this reads. */
interface ReleaseResponse {
  readonly tag_name?: unknown;
  readonly html_url?: unknown;
  readonly published_at?: unknown;
  readonly draft?: unknown;
  readonly prerelease?: unknown;
}

/**
 * Splits a version into comparable numbers.
 *
 * `v0.2.0` and `0.2.0` are the same version: the tag carries the `v` and the
 * manifest does not. Anything after the three numbers — `0.2.0-rc.1` — is
 * ignored for ordering, which is deliberate: a pre-release should never look
 * newer than the release it precedes.
 */
function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `candidate` is strictly newer than `current`. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (a === null || b === null) return false;

  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export interface CheckForUpdateOptions {
  readonly currentVersion?: string;
  readonly url?: string;
  /** Injected by tests. Defaults to the runtime's own `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

export async function checkForUpdate(options: CheckForUpdateOptions = {}): Promise<UpdateStatus> {
  const currentVersion = options.currentVersion ?? APP_VERSION;
  const request = options.fetch ?? globalThis.fetch;

  const unavailable = (problem: string): UpdateStatus => ({
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    downloadUrl: null,
    publishedAt: null,
    problem,
  });

  // A library computer may have no connection at all, and a check that hangs is
  // worse than one that fails: the screen would sit on "checking" forever.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await request(options.url ?? releasesUrl(), {
      headers: { accept: 'application/vnd.github+json' },
      signal: abort.signal,
    });

    // No release yet is a real answer, not a failure: it means this is the
    // newest version there is.
    if (response.status === 404) {
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        downloadUrl: null,
        publishedAt: null,
        problem: null,
      };
    }

    if (!response.ok) {
      return unavailable(`לא ניתן לבדוק עדכונים כרגע (שגיאה ${response.status}).`);
    }

    const release = (await response.json()) as ReleaseResponse;

    if (release.draft === true || release.prerelease === true) {
      return unavailable('הגרסה האחרונה שפורסמה אינה גרסה סופית.');
    }

    const tag = typeof release.tag_name === 'string' ? release.tag_name : null;
    if (tag === null || parseVersion(tag) === null) {
      return unavailable('לא ניתן לקרוא את מספר הגרסה שפורסמה.');
    }

    const latestVersion = tag.replace(/^v/, '');

    return {
      currentVersion,
      latestVersion,
      updateAvailable: isNewerVersion(tag, currentVersion),
      downloadUrl: typeof release.html_url === 'string' ? release.html_url : null,
      publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
      problem: null,
    };
  } catch (cause) {
    // Offline is the ordinary case here, so it is stated plainly rather than
    // dressed up as a fault the librarian has to act on.
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    return unavailable(
      aborted
        ? 'הבדיקה ארכה זמן רב מדי. ייתכן שאין חיבור לאינטרנט.'
        : 'לא ניתן להתחבר כדי לבדוק עדכונים. ייתכן שאין חיבור לאינטרנט.',
    );
  } finally {
    clearTimeout(timer);
  }
}
