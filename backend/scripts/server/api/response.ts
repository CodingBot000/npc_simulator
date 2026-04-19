export interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

export function apiResult<T>(status: number, body: T): ApiResult<T> {
  return { status, body };
}
