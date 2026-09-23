/// <reference path="../node_modules/@figma/plugin-typings/index.d.ts" />

figma.showUI(__html__, { width: 400, height: 520 });

(async () => {
  const generateDown = await figma.clientStorage.getAsync("generateDown");
  figma.ui.postMessage({ type: "settings", generateDown: !!generateDown });
})();

figma.ui.onmessage = async (msg: {
  type: string;
  texts?: string[];
  logoBytes?: Uint8Array;
  centerBytes?: Uint8Array;
  generateDown?: boolean;
}) => {
  if (msg.type === "save-settings") {
    await figma.clientStorage.setAsync("generateDown", !!msg.generateDown);
    return;
  }

  if (msg.type !== "generate") return;

  const selection = figma.currentPage.selection;
  if (selection.length !== 1 || selection[0].type !== "FRAME") {
    figma.ui.postMessage({ type: "error", message: "Select a single frame as template." });
    return;
  }

  const template = selection[0] as FrameNode;
  const texts = (msg.texts || []).filter(t => t.trim() !== "");
  const generateDown = !!msg.generateDown;
  await figma.clientStorage.setAsync("generateDown", generateDown);

  if (texts.length === 0) {
    figma.ui.postMessage({ type: "error", message: "Add at least one text." });
    return;
  }

  // Pre-load all fonts used in the template's text nodes
  const textNodes = template.findAll(n => n.type === "TEXT") as TextNode[];
  const fontNames = new Set<string>();
  for (const t of textNodes) {
    if (t.fontName !== figma.mixed) {
      const fn = t.fontName as FontName;
      fontNames.add(`${fn.family}::${fn.style}`);
    }
  }
  for (const key of fontNames) {
    const [family, style] = key.split("::");
    await figma.loadFontAsync({ family, style });
  }

  const GAP = 50;
  let offsetX = generateDown ? template.x : template.x + template.width + GAP;
  let offsetY = generateDown ? template.y + template.height + GAP : template.y;

  for (const text of texts) {
    const clone = template.clone();
    clone.name = toFrameName(text);
    clone.x = offsetX;
    clone.y = offsetY;
    figma.currentPage.appendChild(clone);

    // Set text in plugin-text node. ";" marks a line break.
    const textNode = findByName(clone, "plugin-text") as TextNode | null;
    if (textNode && textNode.type === "TEXT") {
      textNode.characters = applyLineBreaks(text);
    }

    // Override logo if provided
    if (msg.logoBytes) {
      const logoNode = findByName(clone, "plugin-logo");
      if (logoNode) setImageFill(logoNode, msg.logoBytes);
    }

    // Override center image if provided
    if (msg.centerBytes) {
      const centerNode = findByName(clone, "plugin-center");
      if (centerNode) setImageFill(centerNode, msg.centerBytes);
    }

    if (generateDown) {
      offsetY += clone.height + GAP;
    } else {
      offsetX += clone.width + GAP;
    }
  }

  figma.ui.postMessage({ type: "done", count: texts.length });
};

function applyLineBreaks(text: string): string {
  return text.split(";").map(part => part.trim()).filter(Boolean).join("\n");
}

function toFrameName(text: string): string {
  let slug = "";
  const source = text.toLowerCase();
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const isLetter = ch.toLowerCase() !== ch.toUpperCase();
    const isDigit = ch >= "0" && ch <= "9";
    slug += isLetter || isDigit ? ch : "-";
  }
  slug = slug.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return slug || "frame";
}

function findByName(parent: ChildrenMixin, name: string): SceneNode | null {
  for (const child of parent.children) {
    if (child.name === name) return child;
    if ("children" in child) {
      const found = findByName(child as ChildrenMixin, name);
      if (found) return found;
    }
  }
  return null;
}

function setImageFill(node: SceneNode, bytes: Uint8Array): void {
  if (!("fills" in node)) return;
  const image = figma.createImage(bytes);
  (node as GeometryMixin).fills = [
    { type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" },
  ];
}
