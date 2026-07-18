import { TerminalEditor } from "../../../src/engine/index.js";
import { NodeTerminalHost } from "../../../src/engine/node.js";

const editor = new TerminalEditor({ content: "PTY lifecycle" });
const host = new NodeTerminalHost(editor, { keyboardProtocol: "kitty" });
host.start();
host.stop();
host.stop();
process.stdout.write("PTY_OK");
