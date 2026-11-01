import type { ComponentType, SVGProps } from "react";

import AnthropicGlyph from "../icons/anthropic.svg?react";
import ArchiveGlyph from "../icons/archive.svg?react";
import ArrowElbowDownRightGlyph from "../icons/arrow-elbow-down-right.svg?react";
import ArrowUpGlyph from "../icons/arrow-up.svg?react";
import ArrowUpRightGlyph from "../icons/arrow-up-right.svg?react";
import ArrowsClockwiseGlyph from "../icons/arrows-clockwise.svg?react";
import CaretDownGlyph from "../icons/caret-down.svg?react";
import ChatTextGlyph from "../icons/chat-text.svg?react";
import CheckGlyph from "../icons/check.svg?react";
import CheckCircleGlyph from "../icons/check-circle.svg?react";
import CircleGlyph from "../icons/circle.svg?react";
import CircleDashedGlyph from "../icons/circle-dashed.svg?react";
import CircleHalfGlyph from "../icons/circle-half.svg?react";
import ClaudeCodeGlyph from "../icons/claude-code.svg?react";
import ClockGlyph from "../icons/clock.svg?react";
import CodeGlyph from "../icons/code.svg?react";
import ColumnsGlyph from "../icons/columns.svg?react";
import CopyGlyph from "../icons/copy.svg?react";
import CursorGlyph from "../icons/cursor.svg?react";
import CursorClickGlyph from "../icons/cursor-click.svg?react";
import DotsThreeGlyph from "../icons/dots-three.svg?react";
import EyeSlashGlyph from "../icons/eye-slash.svg?react";
import FilmStripGlyph from "../icons/film-strip.svg?react";
import GearGlyph from "../icons/gear.svg?react";
import GitMergeGlyph from "../icons/git-merge.svg?react";
import GitPullRequestGlyph from "../icons/git-pull-request.svg?react";
import GithubLogoGlyph from "../icons/github-logo.svg?react";
import ImageGlyph from "../icons/image.svg?react";
import KeyboardGlyph from "../icons/keyboard.svg?react";
import LinkGlyph from "../icons/link.svg?react";
import ListBulletsGlyph from "../icons/list-bullets.svg?react";
import ListChecksGlyph from "../icons/list-checks.svg?react";
import ListNumbersGlyph from "../icons/list-numbers.svg?react";
import OpenaiGlyph from "../icons/openai.svg?react";
import OpenrouterGlyph from "../icons/openrouter.svg?react";
import PencilSimpleLineGlyph from "../icons/pencil-simple-line.svg?react";
import QuestionGlyph from "../icons/question.svg?react";
import QuotesGlyph from "../icons/quotes.svg?react";
import RecordGlyph from "../icons/record.svg?react";
import SignOutGlyph from "../icons/sign-out.svg?react";
import SlidersHorizontalGlyph from "../icons/sliders-horizontal.svg?react";
import StackGlyph from "../icons/stack.svg?react";
import TerminalGlyph from "../icons/terminal.svg?react";
import TextBGlyph from "../icons/text-b.svg?react";
import TextItalicGlyph from "../icons/text-italic.svg?react";
import TrashGlyph from "../icons/trash.svg?react";
import UserGlyph from "../icons/user.svg?react";
import UsersGlyph from "../icons/users.svg?react";
import WarningGlyph from "../icons/warning.svg?react";
import WarningDiamondGlyph from "../icons/warning-diamond.svg?react";
import XGlyph from "../icons/x.svg?react";
import XCircleGlyph from "../icons/x-circle.svg?react";
import { IconNames, type IconName } from "./types";

export type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

export const GLYPHS: Readonly<Record<IconName, Glyph>> = {
  [IconNames.ARCHIVE]: ArchiveGlyph,
  [IconNames.ARROW_UP]: ArrowUpGlyph,
  [IconNames.ARROW_UP_RIGHT]: ArrowUpRightGlyph,
  [IconNames.ARROW_ELBOW_DOWN_RIGHT]: ArrowElbowDownRightGlyph,
  [IconNames.ARROWS_CLOCKWISE]: ArrowsClockwiseGlyph,
  [IconNames.CARET_DOWN]: CaretDownGlyph,
  [IconNames.CHAT_TEXT]: ChatTextGlyph,
  [IconNames.CHECK]: CheckGlyph,
  [IconNames.CHECK_CIRCLE]: CheckCircleGlyph,
  [IconNames.CIRCLE]: CircleGlyph,
  [IconNames.CIRCLE_DASHED]: CircleDashedGlyph,
  [IconNames.CIRCLE_HALF]: CircleHalfGlyph,
  [IconNames.CLOCK]: ClockGlyph,
  [IconNames.CODE]: CodeGlyph,
  [IconNames.COLUMNS]: ColumnsGlyph,
  [IconNames.COPY]: CopyGlyph,
  [IconNames.DOTS_THREE]: DotsThreeGlyph,
  [IconNames.EYE_SLASH]: EyeSlashGlyph,
  [IconNames.FILM_STRIP]: FilmStripGlyph,
  [IconNames.GEAR]: GearGlyph,
  [IconNames.GIT_MERGE]: GitMergeGlyph,
  [IconNames.GIT_PULL_REQUEST]: GitPullRequestGlyph,
  [IconNames.GITHUB_LOGO]: GithubLogoGlyph,
  [IconNames.IMAGE]: ImageGlyph,
  [IconNames.KEYBOARD]: KeyboardGlyph,
  [IconNames.LINK]: LinkGlyph,
  [IconNames.LIST_BULLETS]: ListBulletsGlyph,
  [IconNames.LIST_CHECKS]: ListChecksGlyph,
  [IconNames.LIST_NUMBERS]: ListNumbersGlyph,
  [IconNames.PENCIL_SIMPLE_LINE]: PencilSimpleLineGlyph,
  [IconNames.QUESTION]: QuestionGlyph,
  [IconNames.QUOTES]: QuotesGlyph,
  [IconNames.RECORD]: RecordGlyph,
  [IconNames.SIGN_OUT]: SignOutGlyph,
  [IconNames.SLIDERS_HORIZONTAL]: SlidersHorizontalGlyph,
  [IconNames.STACK]: StackGlyph,
  [IconNames.TERMINAL]: TerminalGlyph,
  [IconNames.TEXT_B]: TextBGlyph,
  [IconNames.TEXT_ITALIC]: TextItalicGlyph,
  [IconNames.TRASH]: TrashGlyph,
  [IconNames.USER]: UserGlyph,
  [IconNames.USERS]: UsersGlyph,
  [IconNames.WARNING]: WarningGlyph,
  [IconNames.WARNING_DIAMOND]: WarningDiamondGlyph,
  [IconNames.X]: XGlyph,
  [IconNames.X_CIRCLE]: XCircleGlyph,
  [IconNames.ANTHROPIC]: AnthropicGlyph,
  [IconNames.CLAUDE_CODE]: ClaudeCodeGlyph,
  [IconNames.CURSOR]: CursorGlyph,
  [IconNames.CURSOR_CLICK]: CursorClickGlyph,
  [IconNames.OPENAI]: OpenaiGlyph,
  [IconNames.OPENROUTER]: OpenrouterGlyph,
};
