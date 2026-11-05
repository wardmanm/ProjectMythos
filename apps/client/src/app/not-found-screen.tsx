import { Link } from 'react-router';

/** Any address that is not a screen (14-ui §2). */
export function NotFoundScreen() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="font-display text-2xl">There's no page here</h1>
      <p className="mt-2 text-text-muted">The address may be mistyped, or from an older version.</p>
      <Link
        to="/"
        className="mt-4 inline-flex min-h-11 items-center rounded-md text-accent underline underline-offset-4"
      >
        Go to the library
      </Link>
    </section>
  );
}
