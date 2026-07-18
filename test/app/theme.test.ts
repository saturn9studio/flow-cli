import { describe, expect, it } from "vitest";
import { resolveStyle } from "../../src/engine/index.js";
import {
  FLOW_CLI_THEME_IDS,
  flowCliThemeOptions,
  flowCliThemes,
} from "../../src/app/theme.js";

describe("FlowCLI themes", () => {
  it("matches the public theme catalog", () => {
    expect(flowCliThemeOptions).toEqual([
      { id: "default-theme", label: "Basic Light" },
      { id: "default-dark-theme", label: "Basic Dark" },
      { id: "latte-theme", label: "Latte" },
      { id: "mocha-theme", label: "Mocha" },
      { id: "solarized-light-theme", label: "Solarized Light" },
      { id: "solarized-dark-theme", label: "Solarized Dark" },
    ]);
    expect(Object.keys(flowCliThemes)).toEqual(FLOW_CLI_THEME_IDS);
  });

  it("provides complete editor and shell roles for every theme", () => {
    for (const theme of Object.values(flowCliThemes)) {
      expect(theme.roles.markdownText?.foreground).toBeDefined();
      expect(theme.roles.markdownText?.background).toBeDefined();
      expect(theme.roles.flowMenu?.background).toBeDefined();
      expect(theme.roles.flowMenuDropdown?.background).toEqual(
        theme.roles.flowMenu?.background,
      );
      expect(theme.roles.flowMenuDisabled?.foreground).toBeDefined();
      expect(theme.roles.flowMenuDisabled?.background).toEqual(
        theme.roles.flowMenu?.background,
      );
      expect(theme.roles.flowOverlaySelected?.background).toBeDefined();
      expect(theme.roles.flowEditorBackground?.background).toBeDefined();
      expect(theme.roles.flowStatusActive?.background).toEqual(theme.cursor);
      expect(theme.roles.tableBorder?.background).toEqual(
        theme.roles.markdownText?.background,
      );
      expect(theme.roles.tableCell).toEqual(theme.roles.markdownText);
      expect(theme.roles.tableHeader).toEqual({
        ...theme.roles.markdownText,
        bold: true,
      });
      expect(theme.cursor).toBeDefined();
      expect(theme.roles.markdownListMarker?.foreground).toEqual(theme.cursor);
      expect(theme.roles.markdownQuoteMarker?.foreground).toEqual(theme.cursor);
      expect(theme.roles.markdownQuoteMarker?.background).toEqual(
        theme.roles.flowStatus?.background,
      );
      expect(theme.roles.markdownQuote?.background).toEqual(
        theme.roles.flowStatus?.background,
      );
      expect(theme.roles.markdownCode?.background).toEqual(
        theme.roles.markdownQuote?.background,
      );
      expect(theme.roles.markdownCodeMarkup?.background).toEqual(
        theme.roles.markdownCode?.background,
      );
      expect(theme.roles["codeSyntax.text"]?.background).toEqual(
        theme.roles.markdownQuote?.background,
      );
      expect(theme.roles.codeBlockLabel?.background).toEqual(
        theme.roles.markdownQuote?.background,
      );
    }
    expect(flowCliThemes["default-theme"].cursor).toEqual({
      red: 0,
      green: 122,
      blue: 204,
    });
  });

  it("renders code-block markup on the code background", () => {
    for (const theme of Object.values(flowCliThemes)) {
      expect(resolveStyle(
        { role: "markdownCodeMarkup", backgroundRole: "markdownCode" },
        theme,
      ).background).toEqual(theme.roles.markdownCode?.background);
    }
  });
});
