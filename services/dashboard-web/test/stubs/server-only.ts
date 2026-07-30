/**
 * `server-only` is a build-time marker package: importing it from a client
 * bundle is meant to fail the build. Outside Next's bundler it does not
 * resolve, so tests alias it to this no-op. Nothing is being disabled — the
 * real guarantee is enforced by `next build`, which still runs.
 */
export {};
