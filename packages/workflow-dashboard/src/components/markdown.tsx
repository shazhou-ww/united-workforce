import ReactMarkdown from "react-markdown";
import { useEffect, useState } from "react";
import { createHighlighter, type HighlighterGeneric, type BundledLanguage, type BundledTheme } from "shiki";

let highlighterPromise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | null = null;

const LANGS: BundledLanguage[] = ["typescript", "javascript", "json", "yaml", "bash", "python", "markdown"];

function getHighlighter(): Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> {
  if (highlighterPromise === null) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark"],
      langs: LANGS,
    });
  }
  return highlighterPromise;
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [html, setHtml] = useState<string | null>(null);
  const code = String(children).replace(/\n$/, "");
  const lang = className?.replace("language-", "") ?? "text";

  useEffect(() => {
    let cancelled = false;
    getHighlighter().then((hl) => {
      if (cancelled) return;
      try {
        const result = hl.codeToHtml(code, { lang, theme: "github-dark" });
        setHtml(result);
      } catch {
        setHtml(null);
      }
    });
    return () => { cancelled = true; };
  }, [code, lang]);

  if (html !== null) {
    return (
      <div
        className="rounded overflow-x-auto text-xs my-2"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is safe
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre className="rounded overflow-x-auto text-xs my-2 p-3" style={{ background: "var(--color-bg)" }}>
      <code>{code}</code>
    </pre>
  );
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown
        components={{
          code({ className, children, ...props }) {
            const isInline = !className;
            if (isInline) {
              return (
                <code
                  className="text-xs px-1 py-0.5 rounded"
                  style={{ background: "var(--color-border)", color: "var(--color-accent)" }}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          p({ children }) {
            return <p className="my-1.5 leading-relaxed">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-4 my-1.5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-4 my-1.5">{children}</ol>;
          },
          h1({ children }) {
            return <h1 className="text-lg font-bold mt-3 mb-1">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-base font-bold mt-2 mb-1">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>;
          },
          blockquote({ children }) {
            return (
              <blockquote
                className="border-l-2 pl-3 my-2 text-sm"
                style={{ borderColor: "var(--color-accent)", color: "var(--color-text-muted)" }}
              >
                {children}
              </blockquote>
            );
          },
        }}
      />
    </div>
  );
}
