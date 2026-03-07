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
    label: "Privacy",
    title: "Integritetspolicy",
    updatedAt: "7 mars 2026",
    sections: [
      {
        heading: "Personuppgiftsansvarig och omfattning",
        paragraphs: [
          "MinFakturaKoll ar personuppgiftsansvarig for behandling av data som sker i tjansten.",
          "Policyn galler all behandling i app, backend, support och e-postintegrationer for fakturahantering.",
        ],
      },
      {
        heading: "Vilka uppgifter vi behandlar",
        paragraphs: [
          "Vi behandlar kontodata (e-post, uid, visningsnamn), fakturainnehall, metadata och anvandarens handlingar i appen.",
          "Om du kopplar Gmail/Outlook via OAuth behandlas endast data som kravs for fakturaimport och felhantering.",
        ],
        bullets: [
          "Kontodata: e-post, sessionsdata, autentiseringsstatus",
          "Fakturadata: leverantor, belopp, datum, OCR, bilagor, analysresultat",
          "Sakerhetsdata: loggar, felkoder, abuse- och incidentspar",
          "Integrationsdata: provider, scopes, krypterade OAuth-token, kopplingsstatus",
        ],
      },
      {
        heading: "Syfte och rattslig grund (GDPR)",
        paragraphs: [
          "Behandling sker for att tillhandahalla tjansten, ge support, uppratthalla saker drift och mojliggora frivillig e-postimport.",
          "Rattslig grund ar i huvudsak avtal, rattslig forpliktelse och berattigat intresse. For OAuth-import anvands uttryckligt samtycke i appen.",
        ],
      },
      {
        heading: "Dataminimering, lagring och radering",
        paragraphs: [
          "Vi behandlar inte mer data an nodvandigt och begransar atkomst efter roll och behov.",
          "Data sparas sa lange kontot ar aktivt eller tills radering begars i Profil. Viss data kan sparas langre om lagkrav eller incidentutredning kraver det.",
        ],
        bullets: [
          "Kontoradering tar bort historik, mailkopplingar och tillhorande metadata",
          "OAuth-koppling kan kopplas fran separat utan att kontot raderas",
          "Raderingsbegaran hanteras utan onodigt drojsmal",
        ],
      },
      {
        heading: "Dina rattigheter",
        paragraphs: [
          "Du har ratt till tillgang, rattelse, radering, begransning, dataportabilitet och invandning enligt GDPR.",
          "Begaran skickas till privacy@minfakturakoll.se. Vi kan behova verifiera identitet innan utlammning.",
        ],
      },
      {
        heading: "Overforing och underbitraden",
        paragraphs: [
          "Vi kan anvanda drifts- och molnleverantorer som personuppgiftsbitraden med personuppgiftsbitradesavtal.",
          "Om overforing till land utanfor EU/EES sker anvands tillampliga skyddsatgarder, exempelvis standardavtalsklausuler.",
        ],
      },
    ],
  },
  {
    id: "terms",
    label: "Terms",
    title: "Anvandarvillkor",
    updatedAt: "7 mars 2026",
    sections: [
      {
        heading: "Anvandning av tjansten",
        paragraphs: [
          "Tjansten ar avsedd for laglig hantering av egna fakturor och kostnadsunderlag.",
          "Du ansvarar for att uppladdat eller importerad data far behandlas av dig enligt tillamplig lag och avtal.",
        ],
      },
      {
        heading: "Konto och sakerhet",
        paragraphs: [
          "Du ansvarar for att skydda inloggningsuppgifter och att inte dela kontot med obehoriga.",
          "Vid misstankt intrang ska du omedelbart byta losenord och kontakta support.",
        ],
      },
      {
        heading: "E-postimport och OAuth",
        paragraphs: [
          "Gmail/Outlook-koppling ar frivillig och kraver aktivt godkannande i Profilinstallningar.",
          "Du kan nar som helst koppla fran integrationen. Fran koppling stoppar fortsatt automatiserad behandling via OAuth-kopplingen.",
        ],
      },
      {
        heading: "Ansvarsbegransning",
        paragraphs: [
          "Analys och rekommendationer ar beslutsstod och utgor inte juridisk eller finansiell radgivning.",
          "Vi ansvarar inte for indirekta skador, utebliven besparing eller beslut som tas pa basis av analyserna.",
        ],
      },
      {
        heading: "Otillaten anvandning",
        paragraphs: [
          "Det ar inte tillatet att ladda upp skadlig kod, genomfora intrangsforsok eller missbruka API:er.",
          "Vi kan begransa eller stanga konto vid brott mot villkor, sakerhetsrisk eller lagkrav.",
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
          "Appen anvander nodvandig lagring for inloggning, sessionsfornyelse och grundlaggande anvandarupplevelse.",
          "Vi anvander inte marknadsforingscookies i standardflodet.",
        ],
        bullets: [
          "Sessionsdata for inloggning",
          "Val for vyer och tillfalliga tillstand i appen",
          "Sakerhetsrelaterad lagring for OAuth-floden",
        ],
      },
      {
        heading: "Rattslig grund for cookies",
        paragraphs: [
          "Nodvandig lagring anvands for att leverera en uttryckligen begard digital tjanst.",
          "Icke-nodvandig lagring aktiveras inte utan separat stod i produkt och policy.",
        ],
      },
      {
        heading: "Hur du kan paverka",
        paragraphs: [
          "Du kan rensa lokal lagring i webblasaren och logga ut for att ta bort sparad session.",
          "Om nodvandig lagring blockeras kan centrala funktioner, inklusive OAuth-login, sluta fungera.",
        ],
      },
    ],
  },
  {
    id: "security",
    label: "Sakerhet",
    title: "Sakerhet och dataskydd",
    updatedAt: "7 mars 2026",
    sections: [
      {
        heading: "Tekniska skydd",
        paragraphs: [
          "Trafik till backend skyddas med TLS i produktionsmiljo och atkomst kontrolleras per autentiserad anvandare.",
          "Kansliga integrationshemligheter hanteras med principen om minsta privilegium.",
        ],
        bullets: [
          "Autentisering via verifierad token",
          "Segregerad dataatkomst per uid",
          "Loggning av kritiska handelser och fel",
          "Kryptering av OAuth-token i vila",
        ],
      },
      {
        heading: "OAuth-sakerhet",
        paragraphs: [
          "OAuth-kopplingar anvander state-parameter och PKCE for att minska risk for CSRF och kodinterception.",
          "Scope ar begransade till minsta nodvandiga niva for fakturaimport.",
        ],
      },
      {
        heading: "Incidenthantering",
        paragraphs: [
          "Vi overvakar drift och sakerhet for att upptacka avvikelser, missbruk och driftstorningar.",
          "Vid personuppgiftsincidenter agerar vi enligt GDPR inklusive anmalan till IMY dar sa kravs.",
        ],
      },
      {
        heading: "Kontoradering och fran koppling",
        paragraphs: [
          "Kontoradering i Profil raderar historik och relaterade integrationer enligt produktens raderingsflode.",
          "Fran koppling av mailprovider kan goras separat utan att hela kontot tas bort.",
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
        heading: "Vad kopplingen gor",
        paragraphs: [
          "OAuth-kopplingen gor det mojligt att i framtiden importera fakturor automatiskt fran din e-post.",
          "Kopplingen ar frivillig och aktiveras endast efter att du kryssat i samtycken i Profil.",
        ],
      },
      {
        heading: "Vilken data som behandlas",
        paragraphs: [
          "Syftet ar att identifiera fakturor och bilagor for analys i MinFakturaKoll.",
        ],
        bullets: [
          "Avsandare, amne, datum och mottagare for relevanta meddelanden",
          "Bilagor som ser ut som fakturor (exempelvis PDF, bild)",
          "Teknisk metadata for felsokning och spam/abuse-skydd",
        ],
      },
      {
        heading: "Vad vi inte gor",
        paragraphs: [
          "Vi saljer inte data vidare och anvander inte innehallet for annonsering.",
          "Vi begar inte bredare OAuth-scope an vad importfunktionen kraver.",
        ],
      },
      {
        heading: "Samtycke och aterkallelse",
        paragraphs: [
          "Samtycke loggas med tidpunkt och policyversion nar kopplingen skapas.",
          "Du kan nar som helst koppla fran Gmail/Outlook i Profil, vilket stoppar fortsatt behandling via kopplingen.",
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
        heading: "Support och driftfragor",
        paragraphs: [
          "Kontakt: support@minfakturakoll.se",
          "Bifoga garna tidpunkt, felmeddelande och skarmbild for snabbare felsokning.",
        ],
      },
      {
        heading: "Integritet och GDPR-begaran",
        paragraphs: [
          "Kontakt: privacy@minfakturakoll.se",
          "Ange arende: registerutdrag, rattelse, radering, begransning eller dataportabilitet.",
        ],
      },
      {
        heading: "Sakerhetsrapportering",
        paragraphs: [
          "Misstankta sakerhetsbrister eller missbruk rapporteras till security@minfakturakoll.se.",
          "Skicka aldrig losenord eller fullstandiga kortuppgifter via e-post.",
        ],
      },
    ],
  },
];

