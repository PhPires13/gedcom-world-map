export class HttpError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415;
  constructor(status: HttpError['status'], message: string) {
    super(message);
    this.status = status;
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const badRequest = (message: string) => new HttpError(400, message);
