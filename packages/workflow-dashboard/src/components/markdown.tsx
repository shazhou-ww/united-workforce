import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  type BundledLanguage,
  type BundledTheme,
  createHighlighter,
  type HighlighterGeneric,
} from "shiki";

let highlighterPromise: Promise<HighlighterGeneric<BundledLanguage, BundledTheme>> | null = null;

const LANGS: BundledLanguage[] = [
  "typescript",
  "javascript",
  "json",
  "yaml",
  "bash",
  "python",
  "markdown",
];

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
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (html !== null) {
    return (
      <div className="relative rounded-lg border border-border overflow-hidden my-3">
        {lang !== "text" && (
          <span className="absolute top-2 right-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-mono">
            {lang}
          </span>
        )}
        <div
          className="overflow-x-auto text-xs"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki output is safe
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  return (
    <pre className="rounded-lg overflow-x-auto text-xs my-3 p-3 bg-muted/50 border border-border">
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
                  className="bg-muted rounded px-1.5 py-0.5 text-[13px] font-mono text-foreground"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          p({ children }) {
            return <p className="my-2 leading-relaxed">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-4 my-1.5">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-4 my-1.5">{children}</ol>;
          },
          h1({ children }) {
            return (
              <h1 className="text-lg font-bold mt-3 mb-2 border-b border-border pb-1">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="text-base font-bold mt-2 mb-2 border-b border-border pb-1">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return <h3 className="text-sm font-bold mt-2 mb-1">{children}</h3>;
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-ring pl-3 my-2 text-sm text-muted-foreground bg-muted/30 rounded-r-md py-2">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
