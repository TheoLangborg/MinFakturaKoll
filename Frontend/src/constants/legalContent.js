export const LEGAL_POLICY_VERSIONS = {
  privacy: "2026-03-07",
  terms: "2026-03-07",
  cookies: "2026-03-07",
  security: "2026-03-07",
  oauth: "2026-03-07",
};

export const LEGAL_PAGES = [
  {
    id: "privacy",
    label: "Integritet",
    title: "Integritetspolicy",
    updatedAt: "7 mars 2026",
    sections: [
      {
        heading: "Personuppgiftsansvarig och omfattning",
        paragraphs: [
          "MinFakturaKoll är personuppgiftsansvarig för behandling av data som sker i tjänsten.",
          "Policyn gäller all behandling i app, backend, support och e-postintegrationer för fakturahantering.",
        ],
      },
      {
        heading: "Vilka uppgifter vi behandlar",
        paragraphs: [
          "Vi behandlar kontodata (e-post, uid, visningsnamn), fakturainnehåll, metadata och användarens handlingar i appen.",
          "Om du kopplar Gmail/Outlook via OAuth behandlas endast data som krävs för fakturaimport och felhantering.",
        ],
        bullets: [
          "Kontodata: e-post, sessionsdata, autentiseringsstatus",
          "Fakturadata: leverantör, belopp, datum, OCR, bilagor, analysresultat",
          "Säkerhetsdata: loggar, felkoder, abuse- och incidentspår",
          "Integrationsdata: provider, scopes, krypterade OAuth-token och kopplingsstatus",
        ],
      },
      {
        heading: "Syfte och rättslig grund (GDPR)",
        paragraphs: [
          "Behandling sker för att tillhandahålla tjänsten, ge support, upprätthålla säker drift och möjliggöra frivillig e-postimport.",
          "Rättslig grund är i huvudsak avtal, rättslig förpliktelse och berättigat intresse. För OAuth-import används uttryckligt samtycke i appen.",
        ],
      },
      {
        heading: "Dataminimering, lagring och radering",
        paragraphs: [
          "Vi behandlar inte mer data än nödvändigt och begränsar åtkomst efter roll och behov.",
          "Data sparas så länge kontot är aktivt eller tills radering begärs i Profil. Viss data kan sparas längre om lagkrav eller incidentutredning kräver det.",
        ],
        bullets: [
          "Kontoradering tar bort historik, mailkopplingar och tillhörande metadata",
          "OAuth-koppling kan kopplas från separat utan att kontot raderas",
          "Raderingsbegäran hanteras utan onödigt dröjsmål",
        ],
      },
      {
        heading: "Dina rättigheter",
        paragraphs: [
          "Du har rätt till tillgång, rättelse, radering, begränsning, dataportabilitet och invändning enligt GDPR.",
          "Begäran skickas till privacy@minfakturakoll.se. Vi kan behöva verifiera identitet innan utlämning.",
        ],
      },
      {
        heading: "Överföring och underbiträden",
        paragraphs: [
          "Vi kan använda drifts- och molnleverantörer som personuppgiftsbiträden med personuppgiftsbiträdesavtal.",
          "Om överföring till land utanför EU/EES sker används tillämpliga skyddsåtgärder, exempelvis standardavtalsklausuler.",
        ],
      },
    ],
  },
  {
    id: "terms",
    label: "Villkor",
    title: "Användarvillkor",
    updatedAt: "7 mars 2026",
    sections: [
      {
        heading: "Användning av tjänsten",
        paragraphs: [
          "Tjänsten är avsedd för laglig hantering av egna fakturor och kostnadsunderlag.",
          "Du ansvarar för att uppladdad eller importerad data får behandlas av dig enligt tillämplig lag och avtal.",
        ],
      },
      {
        heading: "Konto och säkerhet",
        paragraphs: [
          "Du ansvarar för att skydda inloggningsuppgifter och att inte dela kontot med obehöriga.",
          "Vid misstänkt intrång ska du omedelbart byta lösenord och kontakta support.",
        ],
      },
      {
        heading: "E-postimport och OAuth",
        paragraphs: [
          "Gmail/Outlook-koppling är frivillig och kräver aktivt godkännande i Profilinställningar.",
          "Du kan när som helst koppla från integrationen. Frånkoppling stoppar fortsatt automatiserad behandling via OAuth-kopplingen.",
        ],
      },
      {
        heading: "Ansvarsbegränsning",
        paragraphs: [
          "Analys och rekommendationer är beslutsstöd och utgör inte juridisk eller finansiell rådgivning.",
          "Vi ansvarar inte för indirekta skador, utebliven besparing eller beslut som tas på basis av analyserna.",
        ],
      },
      {
        heading: "Otillåten användning",
        paragraphs: [
          "Det är inte tillåtet att ladda upp skadlig kod, genomföra intrångsförsök eller missbruka API:er.",
          "Vi kan begränsa eller stänga konto vid brott mot villkor, säkerhetsrisk eller lagkrav.",
        ],
      },
    ],
  },
  {
    id: "cookies",
    label: "Cookies",
    title: "Cookie- och lagringspolicy",
    updatedAt: "7 mars 2026",
    sections: [
      {
        heading: "Vad vi lagrar lokalt",
        paragraphs: [
          "Appen använder nödvändig lagring för inloggning, sessionsförnyelse och grundläggande användarupplevelse.",
          "Vi använder inte marknadsföringscookies i standardflödet.",
        ],
        bullets: [
          "Sessionsdata för inloggning",
          "Val för vyer och tillfälliga tillstånd i appen",
          "Säkerhetsrelaterad lagring för OAuth-flöden",
        ],
      },
      {
        heading: "Rättslig grund för cookies",
        paragraphs: [
          "Nödvändig lagring används för att leverera en uttryckligen begärd digital tjänst.",
          "Icke-nödvändig lagring aktiveras inte utan separat stöd i produkt och policy.",
        ],
      },
      {
        heading: "Hur du kan påverka",
        paragraphs: [
          "Du kan rensa lokal lagring i webbläsaren och logga ut för att ta bort sparad session.",
          "Om nödvändig lagring blockeras kan centrala funktioner, inklusive OAuth-login, sluta fungera.",
        ],
      },
    ],
  },
  {
    id: "security",
    label: "Säkerhet",
    title: "Säkerhet och dataskydd",
    updatedAt: "7 mars 2026",
    sections: [
      {
        heading: "Tekniska skydd",
        paragraphs: [
          "Trafik till backend skyddas med TLS i produktionsmiljö och åtkomst kontrolleras per autentiserad användare.",
          "Känsliga integrationshemligheter hanteras med principen om minsta privilegium.",
        ],
        bullets: [
          "Autentisering via verifierad token",
          "Segregerad dataåtkomst per uid",
          "Loggning av kritiska händelser och fel",
          "Kryptering av OAuth-token i vila",
        ],
      },
      {
        heading: "OAuth-säkerhet",
        paragraphs: [
          "OAuth-kopplingar använder state-parameter och PKCE för att minska risk för CSRF och kodinterception.",
          "Scope är begränsade till minsta nödvändiga nivå för fakturaimport.",
        ],
      },
      {
        heading: "Incidenthantering",
        paragraphs: [
          "Vi övervakar drift och säkerhet för att upptäcka avvikelser, missbruk och driftstörningar.",
          "Vid personuppgiftsincidenter agerar vi enligt GDPR inklusive anmälan till IMY där så krävs.",
        ],
      },
      {
        heading: "Kontoradering och frånkoppling",
        paragraphs: [
          "Kontoradering i Profil raderar historik och relaterade integrationer enligt produktens raderingsflöde.",
          "Frånkoppling av mailprovider kan göras separat utan att hela kontot tas bort.",
        ],
      },
    ],
  },
  {
    id: "oauth",
    label: "E-post OAuth",
    title: "E-postintegration (Gmail och Outlook)",
    updatedAt: "7 mars 2026",
    sections: [
      {
        heading: "Vad kopplingen gör",
        paragraphs: [
          "OAuth-kopplingen gör det möjligt att i framtiden importera fakturor automatiskt från din e-post.",
          "Kopplingen är frivillig och aktiveras endast efter att du kryssat i samtycken i Profil.",
        ],
      },
      {
        heading: "Vilken data som behandlas",
        paragraphs: [
          "Syftet är att identifiera fakturor och bilagor för analys i MinFakturaKoll.",
        ],
        bullets: [
          "Avsändare, ämne, datum och mottagare för relevanta meddelanden",
          "Bilagor som ser ut som fakturor (exempelvis PDF, bild)",
          "Teknisk metadata för felsökning och spam/abuse-skydd",
        ],
      },
      {
        heading: "Vad vi inte gör",
        paragraphs: [
          "Vi säljer inte data vidare och använder inte innehållet för annonsering.",
          "Vi begär inte bredare OAuth-scope än vad importfunktionen kräver.",
        ],
      },
      {
        heading: "Samtycke och återkallelse",
        paragraphs: [
          "Samtycke loggas med tidpunkt och policyversion när kopplingen skapas.",
          "Du kan när som helst koppla från Gmail/Outlook i Profil, vilket stoppar fortsatt behandling via kopplingen.",
        ],
      },
    ],
  },
  {
    id: "contact",
    label: "Kontakt",
    title: "Kontakt, support och dataskydd",
    updatedAt: "7 mars 2026",
    sections: [
      {
        heading: "Support och driftfrågor",
        paragraphs: [
          "Kontakt: support@minfakturakoll.se",
          "Bifoga gärna tidpunkt, felmeddelande och skärmbild för snabbare felsökning.",
        ],
      },
      {
        heading: "Integritet och GDPR-begäran",
        paragraphs: [
          "Kontakt: privacy@minfakturakoll.se",
          "Ange ärende: registerutdrag, rättelse, radering, begränsning eller dataportabilitet.",
        ],
      },
      {
        heading: "Säkerhetsrapportering",
        paragraphs: [
          "Misstänkta säkerhetsbrister eller missbruk rapporteras till security@minfakturakoll.se.",
          "Skicka aldrig lösenord eller fullständiga kortuppgifter via e-post.",
        ],
      },
    ],
  },
];

