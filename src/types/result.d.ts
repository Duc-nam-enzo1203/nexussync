export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never>;
export function err<E>(error: E): Result<never, E>;
export function isOk<T, E>(result: Result<T, E>): result is { readonly ok: true; readonly value: T };
export function isErr<T, E>(result: Result<T, E>): result is { readonly ok: false; readonly error: E };
export function unwrap<T, E>(result: Result<T, E>): T;
export function map<T, U, E>(result: Result<T, E>, fn: (val: T) => U): Result<U, E>;
