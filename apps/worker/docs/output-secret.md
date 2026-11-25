# Output secret guard

- The guard screens every attempt (`screenAttempt`) before the floor validates, salvages, warns or retries, so an attempt holding a secret ends the run at once. It also masks the `log`, `onWarning` and failure-dump `redact` channels, failing the run when any of them saw one, and a failure whose message carries one fails the same way.
- Each secret of at least 12 chars is matched raw and JSON-escaped; one with at least 6 distinct chars also as hex and as base64 at any alignment, and with any spacing or line wrap, except that letters alone, which prose can spell by accident, match only spaced one char at a time.
- The scan is literal, so a reversed, doubly encoded or punctuated-apart secret passes, and so does a letters-only one in longer groups or line-wrapped.
- The secrets are every secret-named env var, each OTLP headers var with its header values and bearer or Basic credentials apart, as written and decoded, plus each var the instance config names as a credential (`listCredentialVars`: `generator.apiKeyEnv`, every `contextSources[].tokenEnv`).
