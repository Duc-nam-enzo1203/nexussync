/**
 * Functional Result<T, E> tagged union for resilient error handling
 */

export const ok = (value) => ({
  ok: true,
  value,
});

export const err = (error) => ({
  ok: false,
  error,
});

export const isOk = (result) => result.ok === true;

export const isErr = (result) => result.ok === false;

export const unwrap = (result) => {
  if (result.ok) {
    return result.value;
  }
  throw new Error(`Attempted to unwrap an Err Result: ${JSON.stringify(result.error)}`);
};

export const map = (result, fn) => {
  if (result.ok) {
    return ok(fn(result.value));
  }
  return result;
};
