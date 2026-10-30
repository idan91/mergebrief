// Generated from src/locales/en.json. Run pnpm generate:types after catalog changes.
import type en from "./locales/en.json";

export type Catalog = typeof en & {
  entryComment: (typeof en)["entryComment"] & {
    capped: (typeof en)["entryComment"]["capped"] & {
      heading: "No brief for {{shortSha}}: this instance reached its daily generation cap.";
      body: "Generation resumes at {{resetsAt}}. The next push after that is briefed as usual.";
    };
    closed: (typeof en)["entryComment"]["closed"] & {
      heading: "No brief for {{shortSha}}: this pull request is no longer open.";
    };
    failed: (typeof en)["entryComment"]["failed"] & {
      heading: "No brief for {{shortSha}}: generation failed.";
    };
  };
  generationError: (typeof en)["generationError"] & {
    "generation-config": "Generator configuration is invalid: {{detail}}";
    unknown: "Generation failed: {{detail}}";
  };
  pulls: (typeof en)["pulls"] & {
    capped: (typeof en)["pulls"]["capped"] & {
      resumes: "Daily generation cap reached. Resumes {{resetsAt, datetime(dateStyle: medium; timeStyle: short)}}";
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
      statedAsks_one: "{{count}} stated ask not found in the diff";
      statedAsks_other: "{{count}} stated asks not found in the diff";
      intentTensions_one: "{{count}} intent tension flagged";
      intentTensions_other: "{{count}} intent tensions flagged";
      unpostedDrafts_one: "You have {{count}} unposted draft comment.";
      unpostedDrafts_other: "You have {{count}} unposted draft comments.";
      postDrafts_one: "Post my {{count}} draft comment before marking ready";
      postDrafts_other: "Post my {{count}} draft comments before marking ready";
    };
    ownDraft: (typeof en)["pulls"]["ownDraft"] & {
      damped: "Draft mode: the brief can take up to {{window}} to refresh after the last push.";
      windowMinutes_one: "about {{count}} minute";
      windowMinutes_other: "about {{count}} minutes";
    };
    latestPush: (typeof en)["pulls"]["latestPush"] & {
      capped: (typeof en)["pulls"]["latestPush"]["capped"] & {
        resumes: "Generation resumes {{resetsAt, datetime(dateStyle: medium; timeStyle: short)}}.";
      };
    };
  };
  brief: (typeof en)["brief"] & {
    header: (typeof en)["brief"]["header"] & {
      ariaLabelSubmitReview_one: "Submit review, {{count}} draft comment";
      ariaLabelSubmitReview_other: "Submit review, {{count}} draft comments";
      repoConfigChipAt: "Repo config @ {{sha}}";
      branchPairAria: "{{head}} into {{base}}";
      stackIndexAria: "Pull request {{index}} of {{total}} in the stack";
      stackMember: "#{{number}} {{title}}";
      stackMemberBranch: "#{{number}} · {{branch}}";
      stackMemberDetail: "{{member}}, {{detail}}";
      stackAsOf: "As of {{date}}";
      stackPrevious: "Previous PR in stack, #{{number}}: {{title}}";
      stackNext: "Next PR in stack, #{{number}}: {{title}}";
    };
    details: (typeof en)["brief"]["details"] & {
      commits_one: "{{count}} commit";
      commits_other: "{{count}} commits";
      warnings_one: "{{count}} generation warning";
      warnings_other: "{{count}} generation warnings";
      collisionsLine_one: "Built-in wins over custom name: {{names}}";
      collisionsLine_other: "Built-in wins over custom names: {{names}}";
      bytesUsed: "{{used}} of {{budget}} bytes";
    };
    intent: (typeof en)["brief"]["intent"] & {
      showAll: "Show all {{count}}";
      jumpToGroup: "Go to change-group {{groupId}}";
      jumpToGroupTitled: "Go to change-group {{groupId}}: {{title}}";
      deviations_one: "<0>{{count}}</0> deviation";
      deviations_other: "<0>{{count}}</0> deviations";
      unavailable: "Intent check unavailable: {{reason}}";
      accomplished_one: "<0>{{count}}</0> accomplished";
      accomplished_other: "<0>{{count}}</0> accomplished";
      maskedFixes_one: "<0>{{count}}</0> masked fix";
      maskedFixes_other: "<0>{{count}}</0> masked fixes";
      statedButMissing_one: "<0>{{count}}</0> stated but missing";
      statedButMissing_other: "<0>{{count}}</0> stated but missing";
      doneButUnstated_one: "<0>{{count}}</0> done but unstated";
      doneButUnstated_other: "<0>{{count}}</0> done but unstated";
      ticketUnread: "{{key}} could not be read.";
      reason: (typeof en)["brief"]["intent"]["reason"] & {
        "not-found": "{{tracker}} returned not found. The page was moved, or the integration has no access to it";
        "no-credential": "{{tracker}} refused the read: no credential is configured for it on this deployment";
        timeout: "{{tracker}} did not answer in time";
        "rate-limited": "{{tracker}} rate-limited the read";
        unsupported: "No {{tracker}} reader is configured on this deployment";
        unsupported_inline: "no {{tracker}} reader is configured on this deployment";
      };
    };
    toolbar: (typeof en)["brief"]["toolbar"] & {
      groupCount: "Group {{current}}/{{total}}";
      changes_one: "{{count}} change";
      changes_other: "{{count}} changes";
      threadsHiddenInDiff_one: "{{count}} thread hidden in the diff";
      threadsHiddenInDiff_other: "{{count}} threads hidden in the diff";
      filterVerdicts_one: "{{count}} verdict";
      filterVerdicts_other: "{{count}} verdicts";
      filterReviewers_one: "{{count}} reviewer";
      filterReviewers_other: "{{count}} reviewers";
      filterHidden: "{{count}} hidden";
      srJumpToCarryingGroup: ", jump to carrying group {{position}} of {{total}} in story order";
    };
    group: (typeof en)["brief"]["group"] & {
      ariaLabelGroupRiskSurface: "Risk surface of {{title}}";
      groupOf: "Group {{index}} of {{total}}";
      chunkCounts: "{{core}} core · {{supporting}} supporting";
      selectedFlags_one: "{{count}} selected flag";
      selectedFlags_other: "{{count}} selected flags";
      ariaLabelReopen: "Reopen the {{attr}} risk on {{file}}";
      filesCount_one: "{{count}} file";
      filesCount_other: "{{count}} files";
      flagsCount_one: "{{count}} flag";
      flagsCount_other: "{{count}} flags";
      resolved_one: "{{count}} resolved";
      resolved_other: "{{count}} resolved";
      selectFile: "Select flags on {{file}}";
    };
    story: (typeof en)["brief"]["story"] & {
      stepOf: "Step {{step}} of {{total}}";
      groupOf: "Change-group {{index}} of {{total}}";
      dominantAnnounce: "Dominant category set to {{category}}, recorded on the receipt.";
      splitterValueText: "Change-group column {{width}} pixels wide";
    };
    changes: (typeof en)["brief"]["changes"] & {
      showInFullAria: "Show in Full brief, {{file}}";
      removedLines_one: "−{{count}} line removed";
      removedLines_other: "−{{count}} lines removed";
      linesNotShown_one: "{{count}} line not shown";
      linesNotShown_other: "{{count}} lines not shown";
    };
    diff: (typeof en)["brief"]["diff"] & {
      summarySkipped: "Summary skipped: {{reason}}.";
      caption: "Diff for {{file}}";
      calloutIn: "In: {{group}}";
      copyLineLink: "Copy link to line {{line}}";
      copyLinesLink: "Copy link to lines {{start}} to {{end}}";
      railNew_one: "New this revision. {{count}} line.";
      railNew_other: "New this revision. {{count}} lines.";
      railRemoved_one: "Removed this revision. {{count}} line.";
      railRemoved_other: "Removed this revision. {{count}} lines.";
      expandUp: "Show {{count}} more lines above";
      expandDown: "Show {{count}} more lines below";
      expandAllUp_one: "Show the {{count}} hidden line above";
      expandAllUp_other: "Show all {{count}} hidden lines above";
      expandAllDown_one: "Show the {{count}} hidden line below";
      expandAllDown_other: "Show all {{count}} hidden lines below";
      expandShown_one: "{{count}} line shown";
      expandShown_other: "{{count}} lines shown";
      expandHiddenThreads_one: "{{count}} comment in the hidden lines";
      expandHiddenThreads_other: "{{count}} comments in the hidden lines";
      siblingSpanRange: "{{from}} to {{to}}";
      siblingSpanGroup_one: "Line {{lines}} belongs to <0/> (group {{index}} of {{total}})";
      siblingSpanGroup_other: "Lines {{lines}} belong to <0/> (group {{index}} of {{total}})";
      siblingSpanGroupRemoved_one: "Removed line {{lines}} belongs to <0/> (group {{index}} of {{total}})";
      siblingSpanGroupRemoved_other: "Removed lines {{lines}} belong to <0/> (group {{index}} of {{total}})";
      siblingSpanJumpGroup: "Go to chunk in {{group}}";
    };
    masthead: (typeof en)["brief"]["masthead"] & {
      coverage_one: "Covers <0/>..<1/> · {{count}} commit";
      coverage_other: "Covers <0/>..<1/> · {{count}} commits";
      descriptionWords_one: "{{count}} word, as the author wrote it";
      descriptionWords_other: "{{count}} words, as the author wrote it";
    };
    markReadyBatch: (typeof en)["brief"]["markReadyBatch"] & {
      counts: "Posted {{posted}} of {{total}}.";
      busyLabel: "Posting {{current}} of {{total}}…";
    };
    riskBadge: (typeof en)["brief"]["riskBadge"] & {
      repoPolicyWithImplication: "Defined by repo policy: {{implication}}";
      srRepoPolicyWithImplication: ", defined by repo policy. {{implication}}";
    };
    timeline: (typeof en)["brief"]["timeline"] & {
      viewingBrief: "Viewing brief {{index}} of {{total}}.";
    };
    chunk: (typeof en)["brief"]["chunk"] & {
      largeDiffHidden_one: "{{count, number}} changed line hidden";
      largeDiffHidden_other: "{{count, number}} changed lines hidden";
      drafts_one: "{{count}} draft";
      drafts_other: "{{count}} drafts";
      addressedCount: "{{count}} addressed";
      reviewCount_one: "{{count}} review comment";
      reviewCount_other: "{{count}} review comments";
      ariaLabelAddFileComment: "Add a comment on {{file}}";
    };
    focusPanel: (typeof en)["brief"]["focusPanel"] & {
      show: "{{label}}: show context (S)";
      groupLabel: "Group {{index}}";
    };
    chunkStrip: (typeof en)["brief"]["chunkStrip"] & {
      markName: "{{file}} line {{line}}, chunk {{index}} of {{total}}";
      markNameNoLine: "{{file}}, chunk {{index}} of {{total}}";
      position: "{{index}} of {{total}}";
      count_one: "{{count}} chunk";
      count_other: "{{count}} chunks";
    };
    sidebar: (typeof en)["brief"]["sidebar"] & {
      revisions: (typeof en)["brief"]["sidebar"]["revisions"] & {
        title: "Revision {{index}}";
      };
    };
    progress: (typeof en)["brief"]["progress"] & {
      segmentLabel: "Group {{index}} of {{total}}: {{title}}";
    };
    sinceMarker: (typeof en)["brief"]["sinceMarker"] & {
      changed_one: "{{count}} file changed since {{sha}}";
      changed_other: "{{count}} files changed since {{sha}}";
    };
    carryOver: (typeof en)["brief"]["carryOver"] & {
      receipt_one: "Your review carried forward · {{count}} item · {{span}} · {{verdict}}";
      receipt_other: "Your review carried forward · {{count}} items · {{span}} · {{verdict}}";
      span: "{{from}} → {{to}}";
      spanRevisions_one: "{{from}} → {{to}} · {{count}} revision";
      spanRevisions_other: "{{from}} → {{to}} · {{count}} revisions";
      pending_one: "{{count}} item from your last review needs a re-look";
      pending_other: "{{count}} items from your last review need a re-look";
    };
  };
  review: (typeof en)["review"] & {
    summary: (typeof en)["review"]["summary"] & {
      evidenceLinkedComment: "Linked comment {{location}}";
      evidenceLinkedComment_inline: "linked comment {{location}}";
      evidenceChunkReviewed: "Reviewed related chunk {{file}}";
      evidenceChunkReviewed_inline: "reviewed related chunk {{file}}";
      evidenceManualWithNote: "Manually verified: {{note}}";
      evidenceManualWithNote_inline: "manually verified: {{note}}";
    };
    submit: (typeof en)["review"]["submit"] & {
      receiptCommentsFold: "Inline comments ({{total}})";
      receiptRiskFold: "Risk disposition: {{addressed}} addressed · {{dismissed}} dismissed · {{open}} open";
    };
    comment: (typeof en)["review"]["comment"] & {
      anchorCross: "{{start}} → {{end}}";
      addressesComments: "Addresses comments {{ids}}";
      replyTo: "Reply to {{id}}";
      lines_one: "{{count}} line";
      lines_other: "{{count}} lines";
      tooLongToPost: "This comment is longer than GitHub's {{max, number}}-character limit. Shorten it to post.";
      tooLongToSave: "This comment is longer than the {{max, number}}-character limit. Shorten it to save.";
    };
    announce: (typeof en)["review"]["announce"] & {
      lineSelected: "Line {{line}} selected.";
      linesSelected: "Lines {{start}} to {{end}} selected.";
      flagsDismissed_one: "{{count}} flag dismissed. Reason recorded verbatim on the receipt.";
      flagsDismissed_other: "{{count}} flags dismissed. Reason recorded verbatim on the receipt.";
      risksAddressed_one: "{{count}} risk marked addressed with evidence.";
      risksAddressed_other: "{{count}} risks marked addressed with evidence.";
    };
    submitResult: (typeof en)["review"]["submitResult"] & {
      postedDegraded: "Review posted. GitHub couldn't anchor {{folded}} of {{total}} comments to the diff, so they were folded into the review body. Nothing was dropped.";
      anchorsFolded: "{{folded}} of {{total}} comments couldn't be anchored on GitHub's side and were folded into the review body. Nothing was dropped.";
      postedDegradedEvery: "Review posted. GitHub couldn't anchor any of your {{total}} comments to the diff, so they were folded into the review body. Nothing was dropped.";
      anchorsFoldedEvery: "None of your {{total}} comments could be anchored on GitHub's side, so all of them were folded into the review body. Nothing was dropped.";
    };
  };
  conversation: (typeof en)["conversation"] & {
    jumpToRevision: "Jump to revision {{sha}}";
    ariaLabelComment: "Comment by {{login}}";
    ariaLabelQuoteReply: "Quote reply to @{{login}}";
    replyTooLong: "This reply is longer than GitHub allows ({{max, number}} characters). Shorten it to post.";
    afterBrief_one: "{{count}} new comment since this brief was generated";
    afterBrief_other: "{{count}} new comments since this brief was generated";
    comments_one: "{{count}} comment";
    comments_other: "{{count}} comments";
    atRevision: "at {{label}}";
    botCount: "{{count}} bot";
    openThreads_one: "{{count}} open thread";
    openThreads_other: "{{count}} open threads";
    showMore_one: "Show {{count}} more";
    showMore_other: "Show {{count}} more";
    srFacetSummary: ", {{humanCount}} from people, {{botCount}} from bots; filters the conversation";
    summaryReviews_one: "{{count}} review";
    summaryReviews_other: "{{count}} reviews";
    summaryComments_one: "{{count}} comment";
    summaryComments_other: "{{count}} comments";
    summaryThreads_one: "{{count}} thread · {{open}} open";
    summaryThreads_other: "{{count}} threads · {{open}} open";
  };
  tokens: (typeof en)["tokens"] & {
    ariaLabelRevoke: "Revoke {{name}}";
    nameTooLong: "Token names are capped at {{max}} characters.";
    rowRevoked: "Revoked {{when}}";
    rowActive: "Expires {{expires}} · last used {{lastUsed}}";
  };
  spend: (typeof en)["spend"] & {
    startedOfCap_one: "This instance has started <0>{{started}} of its {{count}}</0> run today.";
    startedOfCap_other: "This instance has started <0>{{started}} of its {{count}}</0> runs today.";
    allUsed_one: "This instance has used <0>its {{count}}</0> run today.";
    allUsed_other: "This instance has used <0>all {{count}}</0> of its runs today.";
    overCap: "This instance has started <0>{{started}} runs</0> today, past its cap of {{cap}}.";
    uncapped_one: "This instance has started <0>{{count}} run</0> today and has no daily cap.";
    uncapped_other: "This instance has started <0>{{count}} runs</0> today and has no daily cap.";
    resetsLocal: "The count resets at {{local}} your time ({{utc}} UTC), {{relative}}.";
    resetsUtc: "The count resets at {{utc}} UTC, {{relative}}.";
    ticksLabel_one: "{{started}} of {{count}} run started today";
    ticksLabel_other: "{{started}} of {{count}} runs started today";
    stale: "The latest refresh failed. This count was read at {{time}}.";
  };
  shell: (typeof en)["shell"] & {
    footerRights: "© {{year}} Idan Ram. All rights reserved.";
    versionNotice: (typeof en)["shell"]["versionNotice"] & {
      available: "MergeBrief <0>{{latest}}</0> is available.";
      security: "MergeBrief <0>{{latest}}</0> fixes a security issue.";
      running: "This instance runs {{current}}.";
      menuAvailable: "MergeBrief {{latest}} is available";
    };
    pageTitle: (typeof en)["shell"]["pageTitle"] & {
      prNumber: "#{{number}}";
    };
    accountMenu: (typeof en)["shell"]["accountMenu"] & {
      ariaLabelTriggerSignedIn: "Account menu for {{login}}";
      signedInAs: "Signed in as {{login}}";
    };
  };
  home: (typeof en)["home"] & {
    personalLine: (typeof en)["home"]["personalLine"] & {
      attention_one: "{{count}} pull request needs your attention";
      attention_other: "{{count}} pull requests need your attention";
      detail: "{{parts}}.";
      partChanged_one: "{{count}} changed since you reviewed it";
      partChanged_other: "{{count}} changed since you reviewed them";
      partNew_one: "{{count}} is new";
      partNew_other: "{{count}} are new";
      partInProgress_one: "{{count}} in progress";
      partInProgress_other: "{{count}} in progress";
    };
    inbox: (typeof en)["home"]["inbox"] & {
      number: "#{{number}}";
      ageMinutes: "{{count}}m ago";
      ageHours: "{{count}}h ago";
      ageDays: "{{count}}d ago";
      stackChip: "{{index}} of {{size}}";
      stackChipLabel: "Place in a stack: {{index}} of {{size}}";
      byAuthor: "By {{login}}";
      actions: (typeof en)["home"]["inbox"]["actions"] & {
        deletedMany_one: "Deleted {{count}}";
        deletedMany_other: "Deleted {{count}}";
        deletedSome: "Deleted {{done}} of {{total}}; {{failed}} failed";
        archivedMany_one: "Archived {{count}}";
        archivedMany_other: "Archived {{count}}";
        archivedSome: "Archived {{done}} of {{total}}; {{failed}} failed";
        unarchivedMany_one: "Unarchived {{count}}";
        unarchivedMany_other: "Unarchived {{count}}";
        unarchivedSome: "Unarchived {{done}} of {{total}}; {{failed}} failed";
      };
      select: (typeof en)["home"]["inbox"]["select"] & {
        row: "Select {{title}}";
        count_one: "{{count}} selected";
        count_other: "{{count}} selected";
        archive_one: "Archive {{count}}";
        archive_other: "Archive {{count}}";
        unarchive_one: "Unarchive {{count}}";
        unarchive_other: "Unarchive {{count}}";
        delete_one: "Delete {{count}}";
        delete_other: "Delete {{count}}";
        undeletable_one: "{{count}} cannot be deleted";
        undeletable_other: "{{count}} cannot be deleted";
        hint_one: "{{page}} of {{count}} · tick rows to act on them together";
        hint_other: "{{page}} of {{count}} · tick rows to act on them together";
        matching_one: "Select all {{count}} matching";
        matching_other: "Select all {{count}} matching";
        matchingCapped: "Select the first {{cap}} of {{count}} matching";
        allMatching_one: "All {{count}} matching selected";
        allMatching_other: "All {{count}} matching selected";
        firstMatching: "The first {{cap}} of {{count}} matching selected";
        noneDeletable_one: "None of the {{count}} matching rows can be deleted";
        noneDeletable_other: "None of the {{count}} matching rows can be deleted";
      };
      deleteModal: (typeof en)["home"]["inbox"]["deleteModal"] & {
        heading: "Delete briefs for #{{number}} {{repo}}?";
        headingMany_one: "Delete briefs for {{count}} pull request?";
        headingMany_other: "Delete briefs for {{count}} pull requests?";
      };
      purgeModal: (typeof en)["home"]["inbox"]["purgeModal"] & {
        heading: "Delete the attachment branch of {{repo}}?";
        confirmLabel: "Type {{repo}} to confirm";
      };
    };
    filters: (typeof en)["home"]["filters"] & {
      changed_one: "{{count}} changed";
      changed_other: "{{count}} changed";
      chosen_one: "{{count}} chosen";
      chosen_other: "{{count}} chosen";
    };
    pager: (typeof en)["home"]["pager"] & {
      range: "{{first}} to {{last}} of {{total}}";
      page: "Page {{page}}";
    };
    empty: (typeof en)["home"]["empty"] & {
      allArchivedHeading_one: "{{count}} pull request is archived";
      allArchivedHeading_other: "{{count}} pull requests are archived";
    };
  };
};
