// 极简 Markdown 渲染:代码块、行内代码、粗体、段落。
// 刻意不引第三方库 —— 体积小,且不需要 dangerouslySetInnerHTML(全部走 React 节点)。
import { useState } from "react";

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  return (
    <pre>
      <button
        className="copy-code"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "已复制" : "复制"}
      </button>
      <code>{code}</code>
    </pre>
  );
}

// 行内标记:`code` 与 **bold**
function renderInline(text, keyPrefix) {
  const parts = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let last = 0;
  let m;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      parts.push(<code key={`${keyPrefix}-c${i++}`}>{tok.slice(1, -1)}</code>);
    } else {
      parts.push(<strong key={`${keyPrefix}-b${i++}`}>{tok.slice(2, -2)}</strong>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }) {
  const nodes = [];
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m;
  let i = 0;

  const pushProse = (chunk) => {
    if (!chunk.trim()) return;
    chunk.split(/\n{2,}/).forEach((p) => {
      if (p.trim()) nodes.push(<p key={`p${i++}`}>{renderInline(p, `p${i}`)}</p>);
    });
  };

  while ((m = re.exec(text)) !== null) {
    pushProse(text.slice(last, m.index));
    nodes.push(<CodeBlock key={`k${i++}`} code={m[2].replace(/\n$/, "")} />);
    last = m.index + m[0].length;
  }
  // 流式输出时最后一个代码块可能还没闭合,原样按正文渲染
  pushProse(text.slice(last));

  return <>{nodes}</>;
}
