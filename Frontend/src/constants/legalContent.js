export const LEGAL_PAGES = [
  {
    id: "privacy",
    label: "Privacy",
    title: "Integritetspolicy",
    updatedAt: "27 februari 2026",
    sections: [
      {
        heading: "Vilka uppgifter vi behandlar",
        paragraphs: [
          "Vi behandlar uppgifter du själv anger i appen, exempelvis e-post, fakturainformation och metadata om uppladdade filer.",
          "Vi behandlar inte fler personuppgifter än vad som behövs för analys, historik och förbättring av tjänstens funktion.",
        ],
      },
      {
        heading: "Syfte och rättslig grund",
        paragraphs: [
          "Personuppgifter används för att leverera tjänsten, spara historik per användare och skapa relevanta analyser.",
          "Behandling sker främst med stöd av avtal och, där det är tillämpligt, berättigat intresse för säker drift.",
        ],
      },
      {
        heading: "Lagring och radering",
        paragraphs: [
          "Uppgifter lagras så länge kontot är aktivt eller tills du själv raderar konto via Profilinställningar.",
          "När konto raderas i appen raderas även fakturahistorik och relaterad användardata kopplad till kontot.",
          "Du kan också kontakta support för registerutdrag eller frågor om personuppgifter.",
        ],
      },
    ],
  },
  {
    id: "terms",
    label: "Terms",
    title: "Användarvillkor",
    updatedAt: "27 februari 2026",
    sections: [
      {
        heading: "Användning av tjänsten",
        paragraphs: [
          "Tjänsten är avsedd för laglig hantering av egna fakturor och kostnadsunderlag.",
          "Du ansvarar för att uppladdat material får användas och inte bryter mot lag eller avtal.",
        ],
      },
      {
        heading: "Ansvarsbegränsning",
        paragraphs: [
          "Analysresultat är beslutsstöd och utgör inte juridisk eller finansiell rådgivning.",
          "Du ansvarar själv för slutliga beslut, avtal med leverantörer och faktiska besparingsutfall.",
        ],
      },
      {
        heading: "Tillgång och konto",
        paragraphs: [
          "Du ansvarar för att skydda inloggningsuppgifter och rapportera misstänkt obehörig användning.",
          "Du kan när som helst avsluta ditt konto i Profilinställningar. Kontoradering är permanent och kan inte ångras.",
          "Vi kan stänga av konto vid missbruk, säkerhetsrisk eller brott mot dessa villkor.",
        ],
      },
    ],
  },
  {
    id: "cookies",
    label: "Cookies",
    title: "Cookiepolicy",
    updatedAt: "27 februari 2026",
    sections: [
      {
        heading: "Vad som används",
        paragraphs: [
          "Appen använder nödvändiga lagringsmekanismer för inloggning och sessionshantering.",
          "Vi använder inte onödiga spårningscookies i appens standardflöde.",
        ],
      },
      {
        heading: "Hur du kan påverka",
        paragraphs: [
          "Du kan logga ut och rensa lokal data i webbläsaren för att ta bort sparad sessionsinformation.",
          "Vid kontoradering i appen tas även serverlagrad historik bort för användaren.",
          "Vissa funktioner kan sluta fungera om nödvändig lagring blockeras i webbläsaren.",
        ],
      },
    ],
  },
  {
    id: "security",
    label: "Säkerhet",
    title: "Säkerhet och dataskydd",
    updatedAt: "27 februari 2026",
    sections: [
      {
        heading: "Tekniskt skydd",
        paragraphs: [
          "Trafik till backend skickas över säkra anslutningar i produktionsmiljö.",
          "Åtkomst till historik begränsas per inloggad användare.",
        ],
      },
      {
        heading: "Incidenthantering",
        paragraphs: [
          "Vi arbetar med loggning och övervakning för att upptäcka drift- och säkerhetsproblem.",
          "Vid allvarliga incidenter informeras berörda användare enligt tillämpliga regler.",
        ],
      },
      {
        heading: "Kontoradering",
        paragraphs: [
          "Konto kan raderas i Profilinställningar efter bekräftelse. Då raderas konto och historikdata kopplad till användaren.",
          "Om åtgärden kräver ny inloggning kan du behöva logga ut och logga in igen innan radering.",
        ],
      },
    ],
  },
  {
    id: "contact",
    label: "Kontakt",
    title: "Kontakt och support",
    updatedAt: "27 februari 2026",
    sections: [
      {
        heading: "Support",
        paragraphs: [
          "För frågor om appen, datahantering eller kontot kan du kontakta support@minkostnadskoll.se.",
          "Beskriv gärna ärendet med skärmbild och tidpunkt för snabbare felsökning.",
        ],
      },
      {
        heading: "Juridiska frågor",
        paragraphs: [
          "Frågor om integritet, registerutdrag eller radering skickas till privacy@minkostnadskoll.se.",
          "Självservice för kontoradering finns också i Profilinställningar i appen.",
        ],
      },
    ],
  },
];
