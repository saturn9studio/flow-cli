#!/usr/bin/env node

import { NodeTerminalHost } from "../engine/node.js";
import { createFlowCliApp } from "./app.js";
import { helpText, parseArguments } from "./args.js";
import { createNodePlatform } from "./platform/node.js";

const version = process.env.FLOW_CLI_VERSION ?? "0.1.0";

const main = async (): Promise<void> => {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.action === "help") {
    process.stdout.write(helpText);
    return;
  }
  if (arguments_.action === "version") {
    process.stdout.write(`${version}\n`);
    return;
  }

  const platform = createNodePlatform();
  const documentPath = arguments_.path
    ? platform.resolvePath(arguments_.path)
    : undefined;
  const app = await createFlowCliApp(platform, documentPath);
  let host: NodeTerminalHost;
  host = new NodeTerminalHost(app, {
    theme: () => app.terminalTheme,
    cursor: () => app.terminalCursorStyle,
    keyboardProtocol: "auto",
    ctrlCExits: false,
    graphicsProtocol: app.graphicsPolicy,
    onExitRequest: () => app.requestExit(),
  });
  app.setExitHandler(() => host.stop());

  const stop = (): void => host.stop();
  process.once("exit", stop);
  process.once("SIGTERM", () => {
    void app.prepareForTermination().finally(() => {
      host.stop();
      process.exitCode = 143;
    });
  });
  host.start();
};

void main().catch((error: unknown) => {
  process.stderr.write(
    `flow: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
