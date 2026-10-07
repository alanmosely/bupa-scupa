export class ScupaError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'ScupaError';
    this.code = code;
  }
}
