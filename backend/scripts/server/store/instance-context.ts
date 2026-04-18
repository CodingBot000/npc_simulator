export const WORLD_INSTANCE_HEADER = "x-world-instance-id";

const instanceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

export class InvalidWorldInstanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWorldInstanceError";
  }
}

export function normalizeWorldInstanceId(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (!instanceIdPattern.test(trimmed)) {
    throw new InvalidWorldInstanceError(
      `Invalid ${WORLD_INSTANCE_HEADER} header. Use 1-128 chars of letters, numbers, '_' or '-'.`,
    );
  }

  return trimmed;
}

export function getWorldInstanceIdFromRequest(request: Request) {
  return normalizeWorldInstanceId(request.headers.get(WORLD_INSTANCE_HEADER));
}
