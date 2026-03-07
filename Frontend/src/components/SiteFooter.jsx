import { useEffect, useMemo, useState } from "react";
import { LEGAL_PAGES } from "../constants/legalContent.js";

export default function SiteFooter() {
  const [activePageId, setActivePageId] = useState("");
  const activePage = useMemo(
    () => LEGAL_PAGES.find((page) => page.id === activePageId) || null,
    [activePageId]
  );

  useEffect(() => {
    if (!activePage) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setActivePageId("");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePage]);

  return (
    <>
      <footer className="site-footer">
        <div className="site-footer-main">
          <div className="site-footer-brand">
            <strong>MinFakturaKoll</strong>
            <p>Analysera fakturor snabbare, säkrare och mer strukturerat.</p>
          </div>

          <nav className="site-footer-links" aria-label="Footer-länkar">
            {LEGAL_PAGES.map((page) => (
              <button
                key={page.id}
                type="button"
                className="site-footer-link"
                onClick={() => setActivePageId(page.id)}
              >
                {page.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="site-footer-meta">
          <span>© {new Date().getFullYear()} MinFakturaKoll</span>
          <span>Alla rättigheter förbehållna</span>
        </div>
      </footer>

      {activePage && (
        <div className="legal-modal" role="dialog" aria-modal="true" onClick={() => setActivePageId("")}>
          <article className="legal-modal-card" onClick={(event) => event.stopPropagation()}>
            <header className="legal-modal-header">
              <div>
                <h3>{activePage.title}</h3>
                <p>Senast uppdaterad: {activePage.updatedAt}</p>
              </div>

              <button type="button" className="btn btn-secondary" onClick={() => setActivePageId("")}>
                Stäng
              </button>
            </header>

            <div className="legal-modal-body">
              {activePage.sections.map((section) => (
                <section key={section.heading} className="legal-section">
                  <h4>{section.heading}</h4>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{renderParagraphWithMailLinks(paragraph)}</p>
                  ))}
                  {Array.isArray(section.bullets) && section.bullets.length ? (
                    <ul>
                      {section.bullets.map((bullet) => (
                        <li key={bullet}>{bullet}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ))}
            </div>
          </article>
        </div>
      )}
    </>
  );
}

function renderParagraphWithMailLinks(paragraph) {
  const text = String(paragraph || "");
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = [...text.matchAll(emailPattern)];
  if (!matches.length) return text;

  const fragments = [];
  let cursor = 0;

  for (const match of matches) {
    const email = String(match[0] || "").trim();
    const index = Number(match.index);
    if (!email || !Number.isFinite(index)) continue;

    if (index > cursor) {
      fragments.push(text.slice(cursor, index));
    }

    fragments.push(
      <a key={`${email}-${index}`} href={`mailto:${email}`} className="legal-email-link">
        {email}
      </a>
    );
    cursor = index + email.length;
  }

  if (cursor < text.length) {
    fragments.push(text.slice(cursor));
  }

  return fragments;
}
