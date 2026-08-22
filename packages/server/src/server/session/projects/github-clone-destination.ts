import { join } from "node:path";

// How many `-2`, `-3`, ... suffixes to try before giving up. A user with this
// many same-named unrelated checkouts in one parent is misconfigured, not
// waiting on attempt 101.
const MAX_DESTINATION_ATTEMPTS = 100;

const REPO_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/u;

export interface GitHubRepositoryCoordinates {
  owner: string;
  name: string;
}

export type CloneDestination =
  // Nothing is at `path`; clone into it.
  | { kind: "clone"; path: string }
  // `path` already holds a checkout of the same repository; register it as-is.
  | { kind: "reuse"; path: string };

export interface ResolveCloneDestinationInput {
  nameWithOwner: string;
  parentDirectory: string;
  directoryExists: (path: string) => Promise<boolean>;
  // Returns the directory's GitHub origin as `owner/name`, or null when the
  // directory is not a GitHub checkout.
  readGitHubRemote: (path: string) => Promise<string | null>;
}

export class InvalidGitHubRepositoryNameError extends Error {
  readonly kind = "invalid-repository-name";

  constructor(readonly nameWithOwner: string) {
    super(`Invalid GitHub repository name: ${nameWithOwner}`);
    this.name = "InvalidGitHubRepositoryNameError";
  }
}

export class CloneDestinationUnavailableError extends Error {
  readonly kind = "destination-unavailable";

  constructor(readonly parentDirectory: string) {
    super(`No available directory name for the clone in ${parentDirectory}`);
    this.name = "CloneDestinationUnavailableError";
  }
}

/**
 * Splits and validates an `owner/name` pair received from a client. The name
 * becomes a directory name, so `.` and `..` are rejected outright: without that
 * check a crafted `nameWithOwner` would let the clone escape the parent
 * directory.
 */
export function parseRepositoryCoordinates(nameWithOwner: string): GitHubRepositoryCoordinates {
  const segments = nameWithOwner.trim().split("/");
  if (segments.length !== 2) {
    throw new InvalidGitHubRepositoryNameError(nameWithOwner);
  }

  const [owner, name] = segments;
  for (const segment of [owner, name]) {
    if (!segment || segment === "." || segment === ".." || !REPO_SEGMENT_PATTERN.test(segment)) {
      throw new InvalidGitHubRepositoryNameError(nameWithOwner);
    }
  }

  return { owner: owner!, name: name! };
}

function isSameRepository(remote: string | null, nameWithOwner: string): boolean {
  if (!remote) return false;
  return remote.toLowerCase() === nameWithOwner.toLowerCase();
}

/**
 * Picks where `nameWithOwner` should land under `parentDirectory`.
 *
 * Selecting a repository that is already cloned resolves to that checkout
 * rather than a second copy, so re-adding a project is idempotent. An unrelated
 * directory holding the same name gets a numeric suffix instead.
 */
export async function resolveCloneDestination(
  input: ResolveCloneDestinationInput,
): Promise<CloneDestination> {
  const { name } = parseRepositoryCoordinates(input.nameWithOwner);
  const canonical = `${input.nameWithOwner.trim()}`;

  for (let attempt = 0; attempt < MAX_DESTINATION_ATTEMPTS; attempt += 1) {
    const directoryName = attempt === 0 ? name : `${name}-${attempt + 1}`;
    const candidate = join(input.parentDirectory, directoryName);

    if (!(await input.directoryExists(candidate))) {
      return { kind: "clone", path: candidate };
    }

    const remote = await input.readGitHubRemote(candidate);
    if (isSameRepository(remote, canonical)) {
      return { kind: "reuse", path: candidate };
    }
  }

  throw new CloneDestinationUnavailableError(input.parentDirectory);
}
