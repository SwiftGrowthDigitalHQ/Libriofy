export type AuthLoginView = "phone" | "email";

// Temporary business-stage switch: keep the mobile OTP stack intact while
// hiding it from the public auth UI until paid delivery channels are enabled.
export const ENABLE_MOBILE_OTP_AUTH = false;

export const DEFAULT_AUTH_LOGIN_VIEW: AuthLoginView = ENABLE_MOBILE_OTP_AUTH ? "phone" : "email";
