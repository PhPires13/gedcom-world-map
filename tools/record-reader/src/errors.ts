export type RecordReaderErrorCode =
  | "missing_api_key"
  | "input_error"
  | "too_many_pages"
  | "rate_limited"
  | "overloaded"
  | "auth_error"
  | "api_error"
  | "connection_error"
  | "refused"
  | "truncated"
  | "invalid_output";

export class RecordReaderError extends Error {
  readonly code: RecordReaderErrorCode;
  /** Seconds to wait before retrying, when the API said so. */
  readonly retryAfter: number | null;
  /** Raw model text for invalid_output, to help debugging. */
  readonly raw: string | null;

  constructor(
    code: RecordReaderErrorCode,
    message: string,
    opts: { retryAfter?: number | null; raw?: string | null; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "RecordReaderError";
    this.code = code;
    this.retryAfter = opts.retryAfter ?? null;
    this.raw = opts.raw ?? null;
  }

  /** Worth retrying later with the same input. */
  get retryable(): boolean {
    return this.code === "rate_limited" || this.code === "overloaded" || this.code === "connection_error";
  }
}
