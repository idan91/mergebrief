# Review a pull request

This page is for reviewers. It walks through the MergeBrief web app: finding a pull request, reading its brief, deciding on risk flags, commenting, and submitting your review to GitHub. Words in bold are the labels you see on screen. The [glossary](../glossary.md) defines the product's terms.

Your review work stays private until you submit it. A few actions write to GitHub at once, and this page says so where they come up: replying to a thread, resolving one, attaching an image, and the actions on your own draft pull request.

## Sign in

1. Open your instance's address.
2. Click **Sign in with GitHub** and approve the App on GitHub.
3. You land on Home.

If you see "This GitHub account isn't allowed on this instance", ask whoever runs it to add you. A link to a brief brings you back to that brief after you sign in.

## Find a pull request on Home

Home holds a box to paste a pull request URL and your Inbox, the list headed **Briefs**. It lists every pull request you can reach in repositories where the MergeBrief App is installed, plus the ones you pasted.

### Read the attention line

The line above the list counts what is waiting on you, for example "3 pull requests need your attention" followed by "1 changed since you reviewed it, 2 are new." When nothing is waiting it reads **You are all caught up**.

Each row carries a review mark:

| Mark | Meaning |
| --- | --- |
| **New** | You have not opened it. |
| **Updated since your review** | It has new changes since you submitted a review. |
| **In progress** | You started reviewing but have not submitted. |
| **Reviewed** | You submitted a review and nothing changed since. |

**Yours** marks a pull request you opened. A row can also show where its brief stands (**Queued**, **Generating**, **Held**, **On demand**, **Failed**, **Capped**, **Waiting**), **New commits** when GitHub has commits the brief does not cover, its place in a stack such as **2 of 4**, or **Added from a URL**.

### Choose what the list shows

The controls above the list:

- **View**: **Needs you first** puts open pull requests that are new, updated or in progress at the top, and the rest under **Not waiting on you**. **Mixed** keeps one list in sort order.
- **Status**, **Repository** and **Review** filter the rows. Merged and closed pull requests are hidden until you pick them under **Status**.
- **More filters** holds **Author** (**Everyone**, **Mine**, **Others**), **List** (**Inbox** or **Archived**) and, when you reach more than one installation, **Installation**.
- **Show** switches between **All** and **Held** rows. It appears when some pull request is held.
- **Sort** orders by **Updated**, **Generated** or **Created**, **Newest first** or **Oldest first**.
- **Clear** resets the filters.

On a narrow screen the filters fold behind one **Filters** button.

### Search

Type in **Search title or number**, or press `/` to jump there. The search matches titles and pull request numbers. When nothing matches in the current view but something matches elsewhere, the page says where and offers **Show all matches**, **Show archived matches** or **Show matches outside the archive**.

### Archive a pull request

Archive a row you are done with. It leaves your Inbox and comes back by itself when a new brief lands.

1. Hover the row, or move to it with `J` and `K`, and open **More actions**.
2. Click **Archive**. **Undo** appears next to the heading.

To see archived rows, set **More filters** > **List** to **Archived**. Click **Unarchive** in a row's menu to bring it back. To act on several rows, click **Select**, tick the rows, then use **Archive** or **Unarchive** in the bar.

**More actions** also holds **Copy link** and **Open on GitHub**. A repository admin also sees **Delete**, which removes every brief of that pull request and every reviewer's review session. It cannot be undone.

### Add a pull request by its URL

Use this for a repository where the App is not installed.

1. Paste the pull request's address into **Paste a pull request URL**, or press `U` to jump there.
2. Click **Generate brief**.

MergeBrief reads the pull request with your own GitHub access and opens its page. The row is marked **Added from a URL**. MergeBrief never writes to GitHub for it and posts no Entry comment. A later push does not brief it by itself: when the row shows **New commits**, open **More actions** and click **Regenerate**, or paste the URL again.

## Read a brief

Open a row to read its brief. The page has a header, a summary, the change groups with their chunks, and a sidebar.

### Read the header

The header names the pull request, its state, its author and its branches. Below it:

- **Core lines** counts the lines in core chunks. Click it to compare with **All lines**.
- **Unattributed** appears when the model left some changed lines out of every group. Click it to jump to that last group.
- **Chunks** and **Flags** count the brief's chunks and risk flags.
- **Submit** opens the submit dialog. Its count is your draft comments.

The summary section shows who generated the brief, the summary itself, and the Conversation. Open **Brief details** for the commit range, the span, the line counts, the provider and model, and which repo config files applied.

### Check the repo config

A **Repo config** chip appears in the summary only when something went wrong with the repository's `.mergebrief/` files: a file that did not apply, a warning, or a custom attribute that collided with a built-in name. Open it to see each file, **Applied** or **Not applied**, and the reason. When all is well, the same list is under **Brief details**. Fixing the files is the code owner's job ([Configure your repository](../repo-config/README.md)).

### Move through a stack

When the pull request is part of a stack, the header shows a stack chip with arrows. The arrows open the previous and next pull request in the stack. Click the chip to list every pull request in it. When the stack changed after the brief was generated, the list says **Stack changed since this brief was generated** and lets you switch between **Now** and **At generation**.

### Read change groups

A change group is a set of changes that together do one thing. Each group card shows:

- its title and its place, such as **Group 2 of 5**;
- its category after **Dominant:**, and sometimes **Secondary:**. Categories are **Bug fix**, **Logic refactor**, **Move with edits**, **Library bump**, **Pure move**, **New feature**, **Dependency update** and **Schema change**;
- its chunk count as core and supporting, such as "2 core · 3 supporting";
- the **Risk surface** list of its flags.

A core chunk holds the group's intent. A supporting chunk serves it, such as a test, a doc or a config change. Each chunk is labelled **Core** or **Supporting**, with its kind of content: **Implementation**, **Test**, **Doc**, **Spec**, **Config** or **Generated**.

When the model could not decide a group's category, the card says so and offers a button for each candidate. Click the one you agree with. Your pick shows as **Set by you, recorded on the receipt**.

The sidebar lists the groups. Click one to jump to it. Its **This PR** tab shows each group's chunks and which you marked viewed.

### Read every chunk in order

Click **Start read-through** on the reading toolbar. It opens focus mode at the first chunk, so you can walk the brief end to end in its reading order. Press `J` for the next chunk, or `V` to mark it viewed and move on.

### Mark a chunk viewed

Tick **Viewed** on the chunk's header. The chunk collapses. Untick it to open it again.

In focus mode, press `V`, or click **Mark viewed** at the bottom. The chunk collapses and the next one opens.

Viewed marks are yours alone. They count toward "chunks read" on your review, and an unviewed core chunk shows up in the **Before you submit** list.

### Use focus mode

Focus mode shows one group's chunks at a time on a wide column. The summary, toolbar, conversation and sidebar are hidden.

1. Press `Z`, or click **Start read-through**.
2. Move with `J` and `K` by chunk, and `Shift`+`J` and `Shift`+`K` by group.
3. Press `S` to show or hide the group's context: its concern, role and the active chunk's risks.
4. Press `Esc` to close the context, then `Esc` again to leave. Or click **Exit focus mode (Esc)** on the **Focus** pill.

Hover or focus **Keys** in the corner for a reminder of the keys.

### Collapse supporting chunks

Click **Collapse supporting** on the reading toolbar to fold every supporting chunk, so only the core ones stay open. Click again to open them all. You can still open any chunk on its own.

A chunk with more than 750 changed lines starts closed, marked **Large diff**. Click **Show diff** to open it.

### Switch between unified and split diff

Press `D`, or click **Switch to split view** at the foot of the sidebar. The same control then reads **Switch to unified view**. A chunk that only adds lines stays unified. MergeBrief remembers your choice.

### Read on a phone

The page fits a phone. The bar at the bottom holds **Brief controls**, your place in the brief, and one chunk either way.

- **Brief controls** opens a sheet with the counts, **Start read-through**, **Collapse supporting**, the compare controls and **Filter threads**.
- Each chunk's **Chunk actions** menu holds **Comment on file**, **Copy file path**, **Copy link to this chunk** and **Open on GitHub**.

Held sideways, the phone keeps one row stuck at the top with the current chunk, its **Viewed** box and its menu.

## Act on risk flags

A flag is one risk attribute firing on one chunk, such as **Touches auth**. It describes the change and never judges it. [Risk flags](./risk-flags.md) explains each attribute and how to check it.

You decide on each flag in one of two ways. Both work only in the browser, signed in: an API token cannot address, dismiss or reopen a flag.

### Address a flag with evidence

1. In the group's **Risk surface** list, tick the box of each file whose flags you checked.
2. Click **Address selected**.
3. Pick the evidence in **Address risk with evidence**:
   - **Linked comment**: one of your review comments that deals with it.
   - **Reviewed related chunk**: each selected flag links to the chunk it sits on.
   - **Manually verified**: say what you checked in **What did you verify?**
4. Click **Mark addressed**.

### Dismiss a flag

1. Tick the files in **Risk surface**, then click **Dismiss selected…**.
2. Write why the flag does not apply here. The reason appears on your receipt exactly as you write it.
3. Click **Dismiss with reason**. A reason under 12 characters gets a warning first: click **Dismiss anyway** to keep it.

### Reopen a flag

An addressed or dismissed flag shows dimmed, with **Reopen** beside it. A file whose flags are all decided folds under the group's resolved count. Click **Reopen** to put a flag back on the open list.

A decision sticks to the flagged code, so it carries to the next brief. If a later push changes that code, the flag comes back as needing a re-look ([Check carried-over work](#check-carried-over-work)).

## Comment

Comments you write on the diff are drafts. They stay private in your review session until you submit, then post to GitHub together as one review.

### Comment on a line or a range

1. Click the narrow column just left of the code, where the `+` or `-` sign sits. Drag down that column to cover several lines.
2. Write the comment. The editor has **Write** and **Preview** tabs, a formatting bar, and **Insert suggestion** to propose a code change.
3. Click **Start review** for your first draft, or **Add review comment** after that. `Ctrl`+`Enter` or `Cmd`+`Enter` does the same.

You can also select lines first: click a line number, then `Shift`+click another to extend. Then click the sign column inside the selection, or press `Enter`. From the keyboard, move with `↓` and `↑` along a focused diff, press `Space` to select and `Enter` to comment.

### Comment on a file

Click the comment icon in the chunk's header, labelled **Comment on file** on hover. On a phone, use **Chunk actions** > **Comment on file**.

### Attach an image

Paste or drop an image into the comment, or click **Attach image**. MergeBrief pushes it to the repository's `mergebrief/attachments` branch so GitHub can show it. PNG, JPEG, GIF and WebP are accepted, up to 10 MB each. It needs the App installed on the repository with write access to its contents, and no branch rule on `mergebrief/*` ([Images in review comments](../self-host/attachments.md)).

### Edit or delete a draft

Your drafts show on the diff marked **Draft**. Click **Edit** to change one, or **Delete**, then **Delete draft**, to remove it. Deleting a draft works only in the browser. A comment already on GitHub can no longer be edited or deleted here.

### Read and reply in the Conversation

The **Conversation** section in the summary shows the pull request's reviews and comments from GitHub. Threads on lines also show inline on the diff. **New since this brief** marks what came in after the brief was generated. Press `C` to jump to the section.

To reply, open a thread, write in the reply box and click **Reply**. A reply posts to GitHub at once, under your account. **Reply & resolve** posts and resolves the thread in one go.

To quote, click **Quote reply** on a comment. Or select text in a thread and press `R` to quote the selection into the reply box.

### Resolve a thread

Click **Resolve** on a thread, or **Unresolve** on a resolved one. The change happens on GitHub at once.

### Filter the conversation

Open **Filter** on the reading toolbar to narrow the threads by **Verdict** and **Reviewer**, or to show **Only each reviewer's latest**. The filter also hides inline threads; the toolbar counts how many it hid.

## Pick up after new pushes

When the pull request gets new pushes, MergeBrief writes a new brief. Your review session carries over: viewed marks, drafts and flag decisions follow the code they were on.

### Compare with your last review or the previous brief

The header has two controls:

- **View**: **Full brief** shows the whole pull request. **Changes only** shows just what changed, grouped and reviewable in place.
- **Compare**: **Your last review** compares with the commit you last submitted a review at. **Previous brief** compares with the brief before this one. **Off** compares with nothing.

A brief opens on **Full brief** with **Off**. With a comparison on in **Full brief**, changed lines are highlighted and a group card says how many of its files changed. In **Changes only**, click **Show in Full brief** to see a change in context.

**Your last review** needs a submitted review: until then it is unavailable, and so is **Changes only** when there is no previous brief either. Only submitting a review moves the point it compares with. Reading does not.

### Step through the changes

With a comparison on, the reading toolbar shows how many changes there are, with previous and next arrows. Each click jumps to the next changed spot and wraps around at the end.

### Check carried-over work

When your review carries to a new brief, a bar on the brief says so. "Your review carried forward" with "nothing needs a re-look" means every decision still holds. Otherwise it lists each item to look at again:

| Item | What happened | What to do |
| --- | --- | --- |
| **Draft comment lost its lines** | The lines your draft was on changed. | **Re-anchor** it, or **Delete draft**. |
| **Flagged code changed after your decision** | The code under a flag you addressed or dismissed changed. | Check the new code, then **Address** or **Dismiss** again. |
| **Evidence for your decision is gone** | The comment or chunk you linked as evidence is not in this brief. | **Address** with new evidence, or **Dismiss**. |

When a draft's file left the brief, the draft can only be deleted.

### Re-anchor a draft

1. Click **Re-anchor** on the item. A **Re-anchor mode** banner appears.
2. Click or drag across the new lines for the draft.
3. Press `Esc` or click **Cancel re-anchor** to stop.

Re-anchoring works only in the browser.

### Open an earlier revision

The sidebar's **Revisions** tab lists every brief of the pull request, with the newest marked **Latest**. Click one to read it. An earlier revision is marked **Read-only**.

When GitHub has commits the brief you are reading does not cover, a **Newer commits** chip appears. Click it to see where the new brief stands, and **Go to new brief** when it is ready.

## Submit your review

1. Click **Submit** in the header.
2. If anything is unresolved, **Before you submit** lists it. Click an item to jump to it, or click **Continue**. It is advice: you can submit with open items.
3. Choose the outcome: **Comment**, **Approve** or **Request changes**. Write a review comment if you want one.
4. Click **Preview receipt** to check what goes out, or **Submit review** to post it.

The review posts to GitHub under your account, with your drafts as its inline comments. You see "Review posted to GitHub under your account."

### Before you submit

The list groups what is still open:

| Group | Clears when |
| --- | --- |
| **Open risks** | You address or dismiss the flag. |
| **Addressed without evidence** | You address it again with evidence. |
| **Thin dismissal reasons** | You give a longer reason. |
| **Unreviewed core chunks** | You mark the chunk viewed. |
| **Unread unattributed lines** | You mark the unattributed chunk viewed. |
| **Draft comments** | Listed so you can check them before they post. |

### Check the receipt

**Verification receipt** shows your review as it stands: chunks read, flags addressed, dismissed and open, and your comments. It is **Not an approval**. Its tabs are **Signature**, **Open risks**, **Comments** and **Raw**.

The receipt itself stays in MergeBrief. Its counts go on one signature line under your review comment on GitHub, like this:

```text
Reviewed with MergeBrief: 12/14 chunks read · 3 risks addressed · 1 dismissed · 0 open · 2 inline comments
```

The verdict and the words are yours. The signature line only states counts.

### Submit against an older revision

When the pull request got new commits after the brief you read, the dialog warns that your comments anchor to the revision you reviewed and may show as outdated on GitHub. Tick **Submit against the reviewed revision anyway** to go ahead, or close the dialog and move to the newer brief first.

GitHub does not let you approve or request changes on your own pull request. On your own, choose **Comment**.

## Self-review your own draft

When you open your own draft pull request, the header shows **Self-review: your draft**. Submitting a review is locked until the pull request is ready, so the header offers **Mark ready for review** instead of **Submit**.

1. Read your brief and leave drafts as notes for yourself or your reviewers. Click **Post** on a draft to post it to GitHub now.
2. Click **Mark ready for review**.
3. **Before marking ready** lists the risk flags on the brief, stated asks it did not find in the diff, intent tensions, and your unposted drafts. Click **Mark ready anyway**, **Keep self-reviewing**, or the button that posts your drafts first and then marks the pull request ready.

Marking ready needs the App's **Contents: Read & write** permission on the repository.

## When there is no brief yet

The pull request page tells you why there is no brief and what can start one.

| Page says | Why | What starts it |
| --- | --- | --- |
| **No brief for this push yet** | The push is held: a trigger condition is not met. The page lists each one under **Waiting on** or **Needs a change first**. | The conditions passing, or **Generate brief**. |
| **Brief available on demand** | The author is not trusted on this repository yet. | **Generate brief**, once. After that every push is briefed as usual. |
| **Brief generation failed** | Generation failed. The page says why and whether a rerun can help. | A new push, or **Regenerate brief**. |
| **Daily generation cap reached.** | The instance hit its daily cap. | The next push after the reset ([Cap daily generation spend](../self-host/spend-cap.md)). |

**Generate brief**, **Generate on every push** and **Regenerate brief** need push access to the repository, the App installed on it, and an open pull request. Without push access, ask someone who has it. The [CLI](./cli.md) has the same actions.

### Generate a held push

Click **Generate brief** on the page, or **Generate brief** in the row's **More actions** menu on Home. It briefs this push now. Later pushes still wait for their conditions ([Trigger conditions](../repo-config/trigger-conditions.md)).

### Generate on every push

Open **More ways to generate**, next to **Generate brief**, and pick **Generate on every push**. It briefs this push now and every later push, whatever its conditions. To turn it off, untick **Generate on every push** in the row's **More actions** menu on Home.

## Keyboard shortcuts

Press `?` on Home or on a brief to list the shortcuts. Shortcuts stand down while you type in a field.

### On a brief

| Key | Does |
| --- | --- |
| `J` / `K` | Next / previous chunk |
| `Shift`+`J` / `Shift`+`K` | Next / previous group in reading order |
| `C` | Jump to the Conversation section |
| `S` | Toggle the sidebar; in focus mode, show or hide the group context |
| `R` | Quote selected thread text into the reply box |
| `D` | Switch between unified and split diff |
| `Z` | Enter or leave focus mode |
| `V` | In focus mode, mark the current chunk viewed and advance |
| `↓` / `↑` | Next / previous line of the focused diff |
| `Enter` | Comment on the focused line |
| `Esc` | Close a dialog; in focus mode, hide the group context, then leave |
| `?` | Toggle the shortcuts list |

### On Home

| Key | Does |
| --- | --- |
| `J` / `K` | Move the cursor down / up the list |
| `↓` / `↑` | Move the cursor, with focus in the list |
| `Enter` | Open the brief under the cursor |
| `X` | Select rows |
| `/` | Search the briefs |
| `U` | Focus the URL box |
| `Esc` | Close a menu or the shortcuts list |
| `?` | Toggle the shortcuts list |

### Turn off single-key shortcuts

If you use speech input, or a stray key keeps setting shortcuts off, untick **Single-key shortcuts** at the top of the shortcuts list. Keys pressed on their own, such as `J` or `?`, then do nothing. `Esc`, `Enter` and the arrow keys keep working. The choice is saved in this browser.

## Settings

Open the account menu at the top right and click **Settings**.

### Create an API token

The **API tokens** tab makes tokens for the [CLI](./cli.md#create-a-token) and for agents.

1. Enter a **Token name**.
2. Pick a **Scope**: **Read only**, **Read and review in MergeBrief**, or **Read, review, and post to GitHub**. The scope is fixed for the token's life, so pick the least it needs.
3. Pick when it **Expires**: **30 days**, **90 days**, **1 year** or **No expiry**.
4. Click **Create token**, then **Copy token**. It is shown once.

A token acts as you in every organization you reach. Click **Revoke** to stop one; anything using it stops working.

### See today's runs

Operators of the instance also see an **Instance** tab. **Daily runs** shows how many generation runs started today and when the count resets ([Cap daily generation spend](../self-host/spend-cap.md#see-todays-count)).

### Sign out

Click **Sign out** in the account menu, then **This device** or **Everywhere**. Signing out everywhere ends your sessions; your API tokens keep working until you revoke them.
