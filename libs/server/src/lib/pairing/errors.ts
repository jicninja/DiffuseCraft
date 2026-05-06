/**
 * Pairing-protocol specific error codes (design.md §2.2 + FR-7, FR-32).
 *
 * Surface as HTTP 4xx via the anonymous `/pair` endpoint.
 */

export type PairingErrorCode =
  | 'INVALID_INPUT'
  | 'PAIRING_WINDOW_CLOSED'
  | 'PAIRING_REJECTED'
  | 'PAIRING_TOKEN_ALREADY_CLAIMED'
  | 'PAIRING_CODE_MISMATCH'
  | 'PAIRING_MODE_NOT_ALLOWED'
  | 'INTERNET_PAIRING_NOT_SUPPORTED'
  | 'TOKEN_REVOKED';

export class PairingError extends Error {
  public readonly status: number;
  public readonly code: PairingErrorCode;
  public readonly hint?: string;

  constructor(args: { status: number; code: PairingErrorCode; message: string; hint?: string }) {
    super(args.message);
    this.name = 'PairingError';
    this.status = args.status;
    this.code = args.code;
    if (args.hint !== undefined) this.hint = args.hint;
  }
}
