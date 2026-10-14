/** The signed-in viewer as the wire shows them, on the session and the Inbox. */
export interface ViewerView {
  readonly login: string | null;
  readonly avatarUrl: string;
}

/** What `GET /api/auth/session` answers for a live session. */
export interface AuthSessionResponse {
  readonly viewer: ViewerView;
}
