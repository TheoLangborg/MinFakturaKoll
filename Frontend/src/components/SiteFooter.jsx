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
            <strong>MinKostnadskoll</strong>
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
          <span>© {new Date().getFullYear()} MinKostnadskoll</span>
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
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </section>
              ))}
            </div>
          </article>
        </div>
      )}
    </>
  );
}
