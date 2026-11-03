import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Merge-tag ({{first_name}}) and spintax ({a|b|c}) tokens are resolved
 * server-side (and in the client preview) by plain substring regex — see
 * parseMessage()/resolveSpintax() in src/lib/message-variables.ts. If a rich
 * text editor let a user apply formatting to *part* of a token (e.g. bold
 * half of "{{first_name}}"), the token would be split across HTML tags and
 * the resolver would silently fail to match it — the raw token would ship
 * to the recipient. Both nodes below are atomic + non-editable so a token is
 * always a single, unsplittable unit; renderHTML emits the token's full,
 * unbroken text as the span's only content so the substring-based resolvers
 * keep working unchanged.
 */

export interface TokenChipAttributes {
  token: string;
}

export const VariableChip = Node.create({
  name: "variableChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      token: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-variable-token") || element.textContent || "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-variable-token]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-variable-token": node.attrs.token,
        contenteditable: "false",
        class: "email-editor-chip email-editor-chip--variable",
      }),
      node.attrs.token,
    ];
  },
});

export const SpintaxChip = Node.create({
  name: "spintaxChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      token: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-spintax-token") || element.textContent || "",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-spintax-token]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-spintax-token": node.attrs.token,
        contenteditable: "false",
        class: "email-editor-chip email-editor-chip--spintax",
      }),
      node.attrs.token,
    ];
  },
});
