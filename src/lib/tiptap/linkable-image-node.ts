import { Node, mergeAttributes } from "@tiptap/core";

/**
 * A single node (rather than TipTap's stock Image node + a Link mark) that
 * self-wraps in <a href> when `href` is set. Applying a Link mark to an
 * image leaf node doesn't reliably round-trip through TipTap's HTML
 * serializer across versions, so the anchor is built directly into this
 * node's parseHTML/renderHTML instead.
 */

export interface LinkableImageAttributes {
  src: string | null;
  alt: string | null;
  href: string | null;
}

export const LinkableImage = Node.create({
  name: "linkableImage",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("src"),
      },
      alt: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("alt"),
      },
      href: {
        default: null,
        parseHTML: (element: HTMLElement) => element.closest("a")?.getAttribute("href") || null,
      },
    };
  },

  parseHTML() {
    return [
      // Linked image: <a href="..."><img src="..."></a>. This rule matches
      // the *anchor* itself (not the nested <img>) so it fully consumes the
      // element — otherwise the standalone Link mark's own `a[href]` parse
      // rule would independently see the same anchor as a generic wrapper
      // and attach a Link mark to the image node in addition to this node's
      // own href-based self-wrapping, producing nested <a><a>...</a></a> on
      // the next serialize. A higher priority than the default (50) makes
      // sure this rule is tried before the Link mark's rule for the same tag.
      {
        tag: "a[href]",
        priority: 100,
        getAttrs: (element) => {
          const anchor = element as HTMLElement;
          const img = anchor.querySelector(":scope > img[src]");
          if (!img || anchor.children.length !== 1) return false;
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            href: anchor.getAttribute("href"),
          };
        },
      },
      // Plain image, no link
      {
        tag: "img[src]",
        getAttrs: (element) => {
          const img = element as HTMLElement;
          if (img.closest("a")) return false; // handled by the rule above
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            href: null,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { href, ...imgAttrs } = HTMLAttributes as LinkableImageAttributes & Record<string, unknown>;
    const img: [string, Record<string, unknown>] = ["img", mergeAttributes(imgAttrs, { class: "email-editor-image" })];

    if (href) {
      return ["a", { href, target: "_blank", rel: "noopener noreferrer" }, img];
    }
    return img;
  },
});
