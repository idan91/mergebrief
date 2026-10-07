declare function IconButton(props: { label: string }): null;

const EMPTY_STATE = <p>No briefs yet</p>; // reports
const CLOSE_BUTTON = <IconButton label="Close dialog" />; // reports

export { EMPTY_STATE, CLOSE_BUTTON };
