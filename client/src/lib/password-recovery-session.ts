/** UI facade for the single Auth subscription; no second SDK client or listener. */
export {
  getPasswordRecoverySnapshot,
  subscribePasswordRecovery,
  requestPasswordRecovery,
  requestOwnPasswordRecovery,
  submitRecoveredPassword,
  exitPasswordRecovery,
} from "./auth-token";
