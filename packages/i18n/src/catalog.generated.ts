// Generated from locales/en.json. Run pnpm generate:types after catalog changes.
import type en from "../locales/en.json";

export type Catalog = typeof en & {
  errors: (typeof en)["errors"] & {
    "generation-config": "{{detail}}";
  };
  generationError: (typeof en)["generationError"] & {
    "generation-config": "Generator configuration is invalid: {{detail}}";
    unknown: "Generation failed: {{detail}}";
  };
  pulls: (typeof en)["pulls"] & {
    list: (typeof en)["pulls"]["list"] & {
      fallbackTitle: "PR #{{number}}";
    };
    wait: (typeof en)["pulls"]["wait"] & {
      generatingPhase: "Generating the brief — {{phase}}…";
      diffCaption: "Diff for {{file}}";
    };
    capped: (typeof en)["pulls"]["capped"] & {
      resumes: "Daily generation cap reached — resumes {{resetsAt, datetime(dateStyle: medium; timeStyle: short)}}";
    };
    failed: (typeof en)["pulls"]["failed"] & {
      attempts_one: "{{count}} attempt so far.";
      attempts_other: "{{count}} attempts so far.";
    };
    announce: (typeof en)["pulls"]["announce"] & {
      viewingRevision: "Viewing revision {{index}} of {{total}}.";
      viewingRevisionReadOnly: "Viewing revision {{index}} of {{total}}. Read-only.";
    };
    markReadyModal: (typeof en)["pulls"]["markReadyModal"] & {
      flagPolicyImplication: "defined by repo policy — {{implication}}";
      statedAsks_one: "{{count}} stated ask not found in the diff";
      statedAsks_other: "{{count}} stated asks not found in the diff";
      intentTensions_one: "{{count}} intent tension flagged";
      intentTensions_other: "{{count}} intent tensions flagged";
      unpostedDrafts_one: "You have {{count}} unposted draft comment.";
      unpostedDrafts_other: "You have {{count}} unposted draft comments.";
      postDrafts_one: "Post my {{count}} draft comment before marking ready";
      postDrafts_other: "Post my {{count}} draft comments before marking ready";
    };
    timeline: (typeof en)["pulls"]["timeline"] & {
      prevRevision: "Previous revision, {{index}}";
      nextRevision: "Next revision, {{index}}";
      option: "Revision {{index}} of {{total}} · {{sha}}";
      optionBaseSuffix: "(base {{sha}})";
      stepRevision: "Revision {{index}}";
    };
    ownDraft: (typeof en)["pulls"]["ownDraft"] & {
      damped: "Draft mode — the brief can take up to {{window}} to refresh after the last push.";
      windowMinutes_one: "about {{count}} minute";
      windowMinutes_other: "about {{count}} minutes";
    };
    yourBriefs: (typeof en)["pulls"]["yourBriefs"] & {
      ariaDelete: "Delete the brief for {{repo}} #{{number}}";
    };
  };
  brief: (typeof en)["brief"] & {
    details: (typeof en)["brief"]["details"] & {
      commits_one: "{{count}} commit";
      commits_other: "{{count}} commits";
      warnings_one: "{{count}} generation warning";
      warnings_other: "{{count}} generation warnings";
      collisionsLine_one: "built-in wins over custom name: {{names}}";
      collisionsLine_other: "built-in wins over custom names: {{names}}";
      bytesUsed: "{{used}} of {{budget}} bytes";
    };
    intent: (typeof en)["brief"]["intent"] & {
      showAll: "Show all {{count}}";
      jumpToGroup: "go to change-group {{groupId}}";
      jumpToGroupTitled: "go to change-group {{groupId}} — {{title}}";
      deviations_one: "<0>{{count}}</0> deviation";
      deviations_other: "<0>{{count}}</0> deviations";
      linkedTickets_one: "{{count}} linked ticket";
      linkedTickets_other: "{{count}} linked tickets";
      unavailable: "intent check unavailable — {{reason}}";
      accomplished_one: "<0>{{count}}</0> accomplished";
      accomplished_other: "<0>{{count}}</0> accomplished";
      claimedButUnachieved_one: "<0>{{count}}</0> claimed but unachieved";
      claimedButUnachieved_other: "<0>{{count}}</0> claimed but unachieved";
      statedButMissing_one: "<0>{{count}}</0> stated but missing";
      statedButMissing_other: "<0>{{count}}</0> stated but missing";
      doneButUnstated_one: "<0>{{count}}</0> done but unstated";
      doneButUnstated_other: "<0>{{count}}</0> done but unstated";
    };
    toolbar: (typeof en)["brief"]["toolbar"] & {
      groupCount: "Group {{current}}/{{total}}";
      changes_one: "{{count}} change";
      changes_other: "{{count}} changes";
    };
    group: (typeof en)["brief"]["group"] & {
      ariaLabelGroupRiskSurface: "{{title}} — risk surface";
      ariaLabelSelectFlag: "Select {{attr}} flag for {{file}}";
      changeGroupOf: "Change-group {{index}} of {{total}}";
      stepOf: "Step {{step}} of {{total}}";
      secondary: "secondary {{category}}";
      riskSurfaceCount: "Risk surface — {{count}} flags";
      chunkCounts: "{{core}} core · {{supporting}} supporting";
      deEmphasizedCount: "+{{count}} de-emphasized";
      srDeEmphasizedList: ": {{attrs}} — de-emphasized by repo policy";
      flagsIn_one: "{{count}} flag in {{attr}}";
      flagsIn_other: "{{count}} flags in {{attr}}";
      ariaLabelReopen: "Reopen the {{attr}} risk on {{file}}";
    };
    story: (typeof en)["brief"]["story"] & {
      stepLabel: "Step {{step}}";
      groupLabel: "Group {{index}}";
      stepOf: "Step {{step}} of {{total}}";
      groupOf: "Change-group {{index}} of {{total}}";
      dominantAnnounce: "Dominant category set to {{category}} — recorded on the receipt.";
      railDominant: "dominant {{category}}";
      flags_one: "{{count}} flag";
      flags_other: "{{count}} flags";
      railSecondary: "secondary {{category}}";
    };
    changes: (typeof en)["brief"]["changes"] & {
      removedLines_one: "−{{count}} line removed";
      removedLines_other: "−{{count}} lines removed";
    };
    diff: (typeof en)["brief"]["diff"] & {
      summarySkipped: "Summary skipped — {{reason}}.";
      caption: "Diff for {{file}}";
      calloutIn: "In: {{group}}";
    };
    markReadyBatch: (typeof en)["brief"]["markReadyBatch"] & {
      counts: "Posted {{posted}} of {{total}}.";
      busyLabel: "Posting {{current}} of {{total}}…";
    };
    riskBadge: (typeof en)["brief"]["riskBadge"] & {
      repoPolicyWithImplication: "Defined by repo policy — {{implication}}";
      srRepoPolicyWithImplication: " — defined by repo policy. {{implication}}";
    };
    timeline: (typeof en)["brief"]["timeline"] & {
      briefOption: "Brief {{index}}";
      viewingBrief: "Viewing Brief {{index}} of {{total}}";
      briefOptionSha: "Brief {{index}} of {{total}} · {{sha}}";
    };
    chunk: (typeof en)["brief"]["chunk"] & {
      drafts_one: "{{count}} draft";
      drafts_other: "{{count}} drafts";
      addressedCount: "{{count}} addressed";
      reviewCount: "{{count}} review";
    };
    progress: (typeof en)["brief"]["progress"] & {
      segmentLabel: "{{label}} {{step}} of {{total}}: {{title}}";
    };
    sinceMarker: (typeof en)["brief"]["sinceMarker"] & {
      changed_one: "{{count}} file changed since {{sha}}";
      changed_other: "{{count}} files changed since {{sha}}";
    };
    unattributed: (typeof en)["brief"]["unattributed"] & {
      calloutCaveat: "The brief attributed {{attributed}} of {{total}} changed lines. These lines belong to no chunk and appear in no group or concern.";
      bannerRest_one: "changed lines in {{count}} file are not covered by any chunk.";
      bannerRest_other: "changed lines in {{count}} files are not covered by any chunk.";
      fileLines: "lines {{ranges}}";
    };
    carryOver: (typeof en)["brief"]["carryOver"] & {
      receipt_one: "Your review carried forward · {{count}} item · {{span}} · {{verdict}}";
      receipt_other: "Your review carried forward · {{count}} items · {{span}} · {{verdict}}";
      span: "{{from}} → {{to}}";
      spanRevisions_one: "{{from}} → {{to}} · {{count}} revision";
      spanRevisions_other: "{{from}} → {{to}} · {{count}} revisions";
      pending_one: "{{count}} item needs a re-look";
      pending_other: "{{count}} items need a re-look";
    };
  };
  review: (typeof en)["review"] & {
    summary: (typeof en)["review"]["summary"] & {
      byline: "Reviewed by @you · {{repo}} #{{number}} · {{sha}}";
      signature: "Reviewed with MergeBrief / review — summary: {{reviewedChunks}} chunks read, {{addressedRisks}} risks addressed, {{dismissedRisks}} dismissed.";
      evidenceLinkedComment: "linked comment {{location}}";
      evidenceChunkReviewed: "reviewed related chunk {{file}}";
      evidenceManualWithNote: "manually verified: {{note}}";
    };
    submit: (typeof en)["review"]["submit"] & {
      receiptCommentsFold: "Inline comments ({{total}})";
      receiptRiskFold: "Risk disposition — {{addressed}} addressed · {{dismissed}} dismissed · {{open}} open";
      tooManyComments: "A review can carry at most {{max}} comments. Trim {{excess}} draft(s), or submit in parts by deleting some drafts and re-adding them after this review posts.";
    };
    comment: (typeof en)["review"]["comment"] & {
      anchorCross: "{{start}} → {{end}}";
      addressesComments: "addresses comments {{ids}}";
      replyTo: "reply to {{id}}";
      lines_one: "{{count}} line";
      lines_other: "{{count}} lines";
      tooLongToPost: "This comment is longer than GitHub's {{max, number}}-character limit — shorten it to post.";
    };
  };
  conversation: (typeof en)["conversation"] & {
    jumpToRevision: "Jump to revision {{sha}}";
    ariaLabelComment: "Comment by {{login}}";
    ariaLabelQuoteReply: "Quote reply to @{{login}}";
    replyTooLong: "This reply is longer than GitHub allows ({{max, number}} characters) — shorten it to post.";
    afterBrief_one: "{{count}} comment arrived after this brief was generated";
    afterBrief_other: "{{count}} comments arrived after this brief was generated";
    threadsOpen: "{{threads}} threads · {{open}} open";
    comments_one: "{{count}} comment";
    comments_other: "{{count}} comments";
    atRevision: "at {{label}}";
    botCount: "{{count}} bot";
    openThreads_one: "{{count}} open thread";
    openThreads_other: "{{count}} open threads";
    showMore_one: "Show {{count}} more";
    showMore_other: "Show {{count}} more";
  };
  tokens: (typeof en)["tokens"] & {
    ariaLabelRevoke: "Revoke {{name}}";
    nameTooLong: "Token names are capped at {{max}} characters.";
    rowRevoked: "revoked {{when}}";
    rowActive: "expires {{expires}} · last used {{lastUsed}}";
  };
  shell: (typeof en)["shell"] & {
    footerRights: "© {{year}} Idan Ram. All rights reserved.";
    localePicker: (typeof en)["shell"]["localePicker"] & {
      ariaLabelTrigger: "Language: {{locale}}";
    };
  };
};
