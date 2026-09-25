import { Icon } from "../Icon";
import { IconNames, IconSizes } from "../Icon/types";

/** Every toolbar glyph is decorative: the IconButton names the action. */
export const ToolbarIcons = {
  bold: <Icon name={IconNames.TEXT_B} size={IconSizes.MD} />,
  italic: <Icon name={IconNames.TEXT_ITALIC} size={IconSizes.MD} />,
  code: <Icon name={IconNames.CODE} size={IconSizes.MD} />,
  quote: <Icon name={IconNames.QUOTES} size={IconSizes.MD} />,
  bulletedList: <Icon name={IconNames.LIST_BULLETS} size={IconSizes.MD} />,
  numberedList: <Icon name={IconNames.LIST_NUMBERS} size={IconSizes.MD} />,
  taskList: <Icon name={IconNames.LIST_CHECKS} size={IconSizes.MD} />,
  link: <Icon name={IconNames.LINK} size={IconSizes.MD} />,
  suggestion: <Icon name={IconNames.PENCIL_SIMPLE_LINE} size={IconSizes.MD} />,
};

export type ToolbarIconKey = keyof typeof ToolbarIcons;
