// 完整 Markdown 渲染:标题、列表、表格、引用、链接、任务列表、删除线,
// 代码块带语法高亮与复制按钮。
//
// 安全:全部走 react-markdown / lowlight 生成 React 节点,不使用 dangerouslySetInnerHTML。
// 模型输出与粘贴内容都属于不可信内容,这样从根上没有 XSS 面。
import { createElement, memo, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createLowlight } from "lowlight";

// 只注册常用语言。若用 rehype-highlight,它会无条件引入 lowlight 的全量语言包
// (产物 gzip 从 ~70KB 涨到 ~160KB),这里直接控制注册表来避免。
// 未注册的语言仍能正常显示,只是没有配色。
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

// 常见别名 → 已注册的语言名
const ALIAS = {
  sh: "bash", shell: "bash", zsh: "bash", console: "bash",
  "c++": "cpp", "c#": "csharp", cs: "csharp",
  js: "javascript", jsx: "javascript", mjs: "javascript", node: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", rs: "rust", md: "markdown",
  html: "xml", svg: "xml", vue: "xml", yml: "yaml",
};

/** 把 lowlight 产出的 hast 树转成 React 节点(不经过 innerHTML) */
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
  return (
    <button
      className="copy-code"
      onClick={() => {
        navigator.clipboard.writeText(getText());
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

/** 从 react-markdown 传来的 children 里还原纯文本 */
function toText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(toText).join("");
  if (node.props) return toText(node.props.children);
  return "";
}

function CodeBlock({ code, lang }) {
  const highlighted = useMemo(() => {
    const name = ALIAS[lang] || lang;
    try {
      const tree = name && lowlight.registered(name)
        ? lowlight.highlight(name, code)
        : lowlight.highlightAuto(code);
      return tree.children.map(hastToReact);
    } catch {
      return code; // 高亮失败就退回纯文本,绝不影响内容显示
    }
  }, [code, lang]);

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

const components = {
  pre({ children }) {
    const codeEl = Array.isArray(children) ? children[0] : children;
    const className = codeEl?.props?.className || "";
    const lang = /language-([\w+#-]+)/.exec(className)?.[1];
    return <CodeBlock code={toText(codeEl?.props?.children).replace(/\n$/, "")} lang={lang} />;
  },
  // 外链一律新标签打开,并阻断 opener 引用
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    );
  },
  // 宽表格独立横向滚动,避免撑破整个页面
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

export const Markdown = memo(function Markdown({ text }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
