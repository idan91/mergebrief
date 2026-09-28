/** One GitHub user-attachment, shared by every test that renders or routes one. */
export const ATTACHMENT_ASSET_ID = "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00";
export const ATTACHMENT_ASSET_URL = `https://github.com/user-attachments/assets/${ATTACHMENT_ASSET_ID}`;
/** The same asset as a file MergeBrief committed to the repo's attachments branch. */
export const ATTACHMENT_FILE_NAME = `${ATTACHMENT_ASSET_ID}.png`;
export const ATTACHMENT_BRANCH_URL = `https://github.com/octo/hello/blob/mergebrief/attachments/${ATTACHMENT_FILE_NAME}?raw=true`;
