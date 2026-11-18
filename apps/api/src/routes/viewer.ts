// The signed-in viewer as the wire shows them: the session row's login and
// an avatar URL derived from the GitHub user id, so no column stores it.
import type { ViewerView } from "contract";
import type { ReviewerId } from "persistence";

const AVATAR_ORIGIN = "https://avatars.githubusercontent.com/u/";

export function shapeViewer(
  reviewerId: ReviewerId,
  reviewerLogin: string | null,
): ViewerView {
  return { login: reviewerLogin, avatarUrl: `${AVATAR_ORIGIN}${reviewerId}` };
}
