export interface FlowCliArguments {
  readonly action: "edit" | "help" | "version";
  readonly path?: string;
}

export const parseArguments = (arguments_: readonly string[]): FlowCliArguments => {
  let action: FlowCliArguments["action"] = "edit";
  let documentPath: string | undefined;
  for (const argument of arguments_) {
    if (argument === "--help" || argument === "-h") {
      action = "help";
    } else if (argument === "--version" || argument === "-v") {
      action = "version";
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (documentPath) {
      throw new Error("Flow opens one document at a time.");
    } else {
      documentPath = argument;
    }
  }
  return { action, ...(documentPath ? { path: documentPath } : {}) };
};

export const helpText = `Usage: flow-cli [document.md]

Options:
  -h, --help       Show this help
  -v, --version    Show the version

Shortcuts:
  F10              Menu bar
  F2/F3/F4/F5      Focus, Edit, Read, Source modes
  Ctrl+,           Settings
  Ctrl+C/X/V       Copy, cut, paste (Cmd when supported)
  Ctrl+P           Command palette
  Ctrl+F/H         Find, replace
  Ctrl+Q           Exit
`;
