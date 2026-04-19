import { InvalidWorldInstanceError } from "@server/store/instance-context";
import { WorldRepositoryBusyError } from "@server/store/repositories";

export function getApiErrorStatus(error: unknown) {
  if (error instanceof InvalidWorldInstanceError) {
    return 400;
  }

  if (error instanceof WorldRepositoryBusyError) {
    return 409;
  }

  return 500;
}
