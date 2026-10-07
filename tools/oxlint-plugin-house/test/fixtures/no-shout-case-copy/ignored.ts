declare const header: string;
declare const mode: string;
declare const logger: { warn(message: string): void };

const TIMEOUT_ERROR = new Error("The upstream request timed out");
const IS_BEARER = header.startsWith("Bearer ");
const IS_DRAFT = mode === "Draft mode";
const LOG_RETRY = () => logger.warn("Retry scheduled soon");
const PROVIDER = { slug: "openai", name: "OpenAI" };

export { TIMEOUT_ERROR, IS_BEARER, IS_DRAFT, LOG_RETRY, PROVIDER };
