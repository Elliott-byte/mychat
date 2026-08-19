// Full Markdown rendering: headings, lists, tables, blockquotes, links, task
// lists and strikethrough, with syntax-highlighted code blocks and a copy button.
//
// Security: everything becomes React nodes via react-markdown / lowlight — no
// dangerouslySetInnerHTML anywhere. Model output and pasted text are untrusted,
// so this removes the XSS surface entirely rather than trying to sanitise it.
import { createElement, memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createLowlight } from "lowlight";

// Register only the common languages. rehype-highlight would pull in lowlight's
// full language set unconditionally (~70KB → ~160KB gzipped), so we drive the
// registry ourselves. Unregistered languages still render, just without colour.
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const lowlight = createLowlight({
  bash, c, cpp, csharp, css, diff, go, java, javascript,
  json, markdown, php, python, rust, sql, typescript, xml, yaml,
});

// Common aliases → registered language names
const ALIAS = {
  sh: "bash", shell: "bash", zsh: "bash", console: "bash",
  "c++": "cpp", "c#": "csharp", cs: "csharp",
  js: "javascript", jsx: "javascript", mjs: "javascript", node: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", rs: "rust", md: "markdown",
  html: "xml", svg: "xml", vue: "xml", yml: "yaml",
};

/** Convert lowlight's hast tree into React nodes (never touching innerHTML) */
function hastToReact(node, key) {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;
  const cls = node.properties?.className;
  return createElement(
    node.tagName,
    { key, className: Array.isArray(cls) ? cls.join(" ") : cls },
    node.children?.length ? node.children.map(hastToReact) : undefined
  );
}

function CopyButton({ getText }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      className="copy-code"
      onClick={() => {
        navigator.clipboard.writeText(getText());
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Recover plain text from the children react-markdown hands us */
function toText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(toText).join("");
  if (node.props) return toText(node.props.children);
  return "";
}

function CodeBlock({ code, lang, streaming }) {
  const highlighted = useMemo(() => {
    // Re-highlighting a growing block on every flush is O(n^2), and an unlabeled
    // fence runs auto-detection across every registered language each time.
    // Plain text while streaming; highlight once the block settles.
    if (streaming) return code;
    const name = ALIAS[lang] || lang;
    try {
      const tree = name && lowlight.registered(name)
        ? lowlight.highlight(name, code)
        : lowlight.highlightAuto(code);
      return tree.children.map(hastToReact);
    } catch {
      return code; // if highlighting fails, fall back to plain text rather than losing content
    }
  }, [code, lang, streaming]);

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{lang || "code"}</span>
        <CopyButton getText={() => code} />
      </div>
      <pre>
        <code className="hljs">{highlighted}</code>
      </pre>
    </div>
  );
}

function makeComponents(streaming) {
  return {
  pre({ children }) {
    const codeEl = Array.isArray(children) ? children[0] : children;
    const className = codeEl?.props?.className || "";
    const lang = /language-([\w+#-]+)/.exec(className)?.[1];
      return (
        <CodeBlock
          code={toText(codeEl?.props?.children).replace(/\n$/, "")}
          lang={lang}
          streaming={streaming}
        />
      );
  },
  // External links always open in a new tab with the opener reference severed
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  // Wide tables scroll on their own so they never stretch the page
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
  };
}

const staticComponents = makeComponents(false);
const streamingComponents = makeComponents(true);

export const Markdown = memo(function Markdown({ text, streaming }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={streaming ? streamingComponents : staticComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
