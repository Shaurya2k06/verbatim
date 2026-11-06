// Renders the repository's own documents (published with the build), so the site and the docs cannot drift.
import { marked } from "marked";
import { useMemo } from "react";
import { useText } from "../lib/data";
import { Failed, Loading } from "./States";

const REPO = "https://github.com/shaurya2k06/verbatim/blob/main/contracts/docs/";

export function Markdown({ path, strip = false }) {
  const s = useText(path);
  const html = useMemo(() => {
    if (!s.data) return "";
    let text = s.data;
    if (strip) text = text.replace(/^# .*\n/, "");
    // Relative links in the docs point into the repository.
    const renderer = new marked.Renderer();
    const link = renderer.link.bind(renderer);
    renderer.link = (t) => link({ ...t, href: /^(https?:|#|mailto:)/.test(t.href) ? t.href : REPO + t.href.replace(/^\.\//, "") });
    return marked.parse(text, { renderer, gfm: true });
  }, [s.data, strip]);
  if (s.loading) return <Loading />;
  if (s.error) return <Failed what={path} error={s.error} />;
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
