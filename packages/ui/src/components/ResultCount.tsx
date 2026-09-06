import { plural } from '../api.js';

interface ResultCountProps {
  /** How many rows are on the screen. */
  readonly shown: number;
  /** How many there are, which is not the same thing. */
  readonly total: number;
  readonly singular: string;
  readonly plural: string;
}

/**
 * How many rows there are, and how many of them are visible.
 *
 * A list is capped so that a real catalogue — two thousand books — does not
 * become two thousand table rows. Reporting the number of rows on screen as
 * though it were the size of the library is worse than reporting nothing: a
 * librarian who imports 2,039 titles and reads "200 ספרים" has every reason to
 * think the import lost most of their books.
 *
 * So the total leads, and the cap is stated plainly when it applies.
 */
export function ResultCount({ shown, total, singular, plural: pluralWord }: ResultCountProps): JSX.Element {
  const truncated = shown < total;

  return (
    <span className="count">
      {plural(total, singular, pluralWord)}
      {truncated && <span className="muted"> · מוצגים {shown} הראשונים</span>}
    </span>
  );
}
