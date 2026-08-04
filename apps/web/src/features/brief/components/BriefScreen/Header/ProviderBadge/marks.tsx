// Official provider marks (BRIEF-103 PR 3). Every path here is byte-exact
// from the provider's OWN published asset (accuracy gate: real logos only,
// verifiably one-to-one from official sources — hand-drawn approximations
// are forbidden). Only the fill is normalized to currentColor, and each
// mark's monochrome variant is itself an official kit variant. Rendered
// aria-hidden with a sibling sr-only provider name; verified rendering at
// 12px before commit (renders next to the official reference).
//
// Sources (retrieved 2026-08-04):
// - anthropic: "Anthropic symbol - Ivory.svg", Anthropic press kit
//   (https://www.anthropic.com/press-kit, Anthropic logos / 2 Anthropic symbol).
// - claude-code: the spark glyph path of "Claude Code logo - One-color.svg",
//   same press kit (Claude logos / 2 Claude Code logo); bbox-tight viewBox.
// - openai: "OAI_OpenAI-Blossom_White.svg", OpenAI brand kit
//   (https://cdn.openai.com/brand/openai-logos.zip via https://openai.com/brand).
// - openrouter: the wordmark's glyph path (class st-glyph) of
//   https://openrouter.ai/brand/v2/openrouter-dark.svg; bbox-tight viewBox.
//
// Codex deliberately has NO mark here: OpenAI publishes no standalone Codex
// logomark (checked openai.com/brand kit, developers.openai.com/codex, the
// openai/codex repo), so it takes the named fallback — a generic glyph plus
// the provider name as text ("provider logo assets" board ticket filed).
import styles from "./ProviderBadge.module.scss";

export function AnthropicMark() {
  return (
    <svg
      aria-hidden="true"
      className={styles["mark"]}
      focusable="false"
      viewBox="0 0 92 64"
    >
      <path
        d="M65.92 0H51.9314L77.44 64H91.4286L65.92 0Z"
        fill="currentColor"
      />
      <path
        d="M25.5086 0L0 64H14.2629L19.4798 50.56H46.166L51.3829 64H65.6457L40.1371 0H25.5086ZM24.0933 38.6743L32.8229 16.1829L41.5525 38.6743H24.0933Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ClaudeCodeMark() {
  return (
    <svg
      aria-hidden="true"
      className={styles["mark"]}
      focusable="false"
      viewBox="0 0 2000 2000"
    >
      <path
        d="M1896,1106l-252-18h-136l-56-4-128-12-4-6,4-2,286-68,192-38,164-40,28-68-8-32-70-32-152,26-130,22-238,52h-14l-6-8,64-114,106-142,74-94,88-112,28-98-62-94h-86l-46,36-72,76-60,68-138,172-82,108-20,22h-18l30-164,48-242,22-154,6-36-40-58-48-22-62,40-32,76-6,64-20,224-20,174-10,144v12h-14l-8-22-20-68-38-76-130-252-82-186-52-118-34-30L558,0l-34,12-62,84c0,22,2.7,42,8,60l14,52,54,86,120,208,112,204,14,22v6l-14,8-30-24-208-154-158-122-74-58-18-4-74-6-54,60,12,84,30,38,60,42,112,82,212,140,198,132,8,8,10,8-4,14h-32l-204-22-138-8-190-12-126-10-58-4-40,26-4,30,44,60,48,10,190,10,194,8,224,6,66,4h20l6,10-6,20-394,220-158,110-20,20-6,62,42,38,94-12,528-344h4l2,12-78,90-120,158-198,254-34,48-6,56,60,30,34-14,144-152,182-246,120-164,10-2,2,4-14,52-24,158-26,128-32,160-28,124,28,62,50,38,60-24,26-30,58-604,10-8,96,162,118,182,116,160,54,10,52-18,14-28-10-90-196-294-36-54v-14h10l160,134,72,62,184,140,28,4,26-40-10-48-210-194-166-150-92-90v-8h16l108,26,320,76,136,32,102-50,6-42-38-52-66-44Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function OpenAiMark() {
  return (
    <svg
      aria-hidden="true"
      className={styles["mark"]}
      focusable="false"
      viewBox="0 0 716 716"
    >
      <path
        d="M508.749 317.399C516.777 287.314 508.991 253.884 485.389 230.282C461.788 206.681 428.36 198.895 398.273 206.923C376.231 184.928 343.39 174.956 311.148 183.596C278.906 192.234 255.45 217.292 247.36 247.361C217.291 255.451 192.233 278.91 183.595 311.149C174.957 343.391 184.927 376.232 206.924 398.274C198.896 428.359 206.683 461.789 230.284 485.391C253.885 508.992 287.313 516.779 317.401 508.75C339.442 530.745 372.286 540.717 404.525 532.079C436.767 523.441 460.223 498.384 468.313 468.315C498.383 460.224 523.44 436.766 532.078 404.526C540.716 372.285 530.747 339.443 508.749 317.402V317.399ZM470.899 244.776C486.892 260.77 493.488 282.601 490.687 303.412L415.577 260.046C412.411 258.218 408.509 258.218 405.345 260.046L317.401 310.82V277.526C317.401 275.191 318.652 273.005 320.676 271.837L387.644 233.174C414.178 218.353 448.346 222.223 470.901 244.776H470.899ZM357.837 311.144L398.275 334.491V381.185L357.837 404.532L317.398 381.185V334.491L357.837 311.144ZM264.776 269.693C265.207 239.305 285.644 211.649 316.453 203.393C338.3 197.54 360.505 202.744 377.127 215.573L302.014 258.937C298.848 260.764 296.898 264.144 296.898 267.798V369.346L268.065 352.699C266.043 351.531 264.776 349.353 264.776 347.017V269.691V269.693ZM203.391 316.454C209.244 294.608 224.854 277.978 244.276 269.999V356.73C244.276 360.384 246.226 363.763 249.392 365.591L337.337 416.365L308.503 433.013C306.481 434.181 303.961 434.188 301.939 433.02L234.971 394.357C208.868 378.789 195.138 347.261 203.391 316.454ZM244.775 470.9C228.781 454.906 222.186 433.075 224.986 412.264L300.096 455.63C303.263 457.457 307.164 457.457 310.328 455.63L398.273 404.856V438.149C398.273 440.485 397.022 442.671 394.997 443.839L328.029 482.502C301.495 497.322 267.327 493.452 244.772 470.9H244.775ZM450.897 445.982C450.466 476.371 430.029 504.027 399.22 512.283C377.373 518.136 355.168 512.932 338.547 500.102L413.659 456.738C416.826 454.911 418.775 451.532 418.775 447.877V346.329L447.609 362.977C449.631 364.145 450.897 366.323 450.897 368.659V445.985V445.982ZM512.282 399.221C506.429 421.068 490.819 437.697 471.397 445.676V358.946C471.397 355.292 469.448 351.912 466.281 350.085L378.336 299.311L407.17 282.663C409.192 281.495 411.712 281.487 413.734 282.655L480.702 321.318C506.805 336.887 520.536 368.415 512.282 399.221Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function OpenRouterMark() {
  return (
    <svg
      aria-hidden="true"
      className={styles["mark"]}
      focusable="false"
      viewBox="19.82 17.2 365.56 258.3"
    >
      <path
        d="M303.9475,17.19926c42.79734,0,77.48933,34.69327,77.48933,77.48933s-34.69199,77.48933-77.48933,77.48933l76.86166,76.86244c9.76367,9.76313,2.84903,26.45667-10.95697,26.45667h-220.88335c-71.32686,0-129.14889-57.82202-129.14889-129.14889S77.64197,17.19926,148.96884,17.19926h154.97866ZM148.96884,68.85881c-42.79607,0-77.48933,34.69327-77.48933,77.48933s34.69327,77.48933,77.48933,77.48933,77.48933-34.69327,77.48933-77.48933-34.69327-77.48933-77.48933-77.48933Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * The named-fallback glyph for providers with no sourced official mark
 * (codex today) and unknown/self-hosted provider tokens. Deliberately
 * generic — a plain terminal chevron-and-line, imitating nobody.
 */
export function GenericProviderMark() {
  return (
    <svg
      aria-hidden="true"
      className={styles["mark"]}
      focusable="false"
      viewBox="0 0 16 16"
    >
      <path
        d="M2.5 3.5L7 8l-4.5 4.5M8.5 12.5h5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
