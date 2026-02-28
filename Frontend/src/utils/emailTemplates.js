import { formatAmountWithCurrency } from "./numberFormat.js";

export function buildEmailTemplatesFromExtracted(extracted) {
  const context = buildTemplateContext(extracted);
  const commonTemplates = buildCommonTemplates(context);
  const categoryTemplates = buildCategoryTemplates(context.category, context);
  return [...commonTemplates, ...categoryTemplates];
}

function buildTemplateContext(extracted) {
  return {
    vendor: extracted?.vendorName || "leverantören",
    category: normalizeCategory(extracted?.category),
    customer: extracted?.customerNumber || "okänt",
    invoiceNumber: extracted?.invoiceNumber || "okänt",
    amountText:
      extracted?.totalAmount != null
        ? formatAmountWithCurrency(extracted.totalAmount, extracted.currency || "SEK")
        : "okänt belopp",
    dueDateText: extracted?.dueDate || "okänt förfallodatum",
    paymentMethod: extracted?.paymentMethod || "okänt betalsätt",
  };
}

function buildCommonTemplates(context) {
  const { vendor, customer, invoiceNumber, amountText, dueDateText, paymentMethod } = context;

  return [
    {
      type: "cancel_email",
      templateId: "cancel-formal",
      templateLabel: "Uppsägningsmall",
      subject: `Uppsägning av abonnemang - kundnummer ${customer}`,
      body:
        `Hej,\n\n` +
        `Jag vill säga upp mitt abonnemang hos ${vendor}.\n` +
        `Kundnummer: ${customer}\n` +
        `Fakturanummer: ${invoiceNumber}\n` +
        `Vänligen bekräfta uppsägningen samt vilket datum avtalet upphör.\n\n` +
        `Tack på förhand.\n` +
        `Med vänlig hälsning`,
    },
    {
      type: "cancel_email",
      templateId: "cancel-fast-track",
      templateLabel: "Uppsägning snabb",
      subject: `Direkt uppsägning - kundnummer ${customer}`,
      body:
        `Hej,\n\n` +
        `Jag önskar avsluta tjänsten hos ${vendor} så snart uppsägningstiden tillåter.\n` +
        `Kundnummer: ${customer}\n` +
        `Fakturanummer: ${invoiceNumber}\n\n` +
        `Återkom med slutdatum och eventuell slutfaktura.\n\n` +
        `Med vänlig hälsning`,
    },
    {
      type: "cancel_email",
      templateId: "price-negotiation",
      templateLabel: "Förhandlingsmall",
      subject: `Förfrågan om bättre pris - kundnummer ${customer}`,
      body:
        `Hej,\n\n` +
        `Jag har granskat min senaste faktura från ${vendor} och vill se över min kostnad.\n` +
        `Nuvarande belopp: ${amountText}\n` +
        `Fakturanummer: ${invoiceNumber}\n` +
        `Kan ni erbjuda ett bättre pris eller ett mer fördelaktigt paket?\n\n` +
        `Om det inte finns en konkurrenskraftig lösning vill jag gå vidare med uppsägning.\n\n` +
        `Med vänlig hälsning`,
    },
    {
      type: "cancel_email",
      templateId: "price-negotiation-match",
      templateLabel: "Förhandling: prismatch",
      subject: `Begäran om prismatch för befintlig kund ${customer}`,
      body:
        `Hej,\n\n` +
        `Jag vill fortsätta som kund hos ${vendor}, men behöver en bättre prisnivå.\n` +
        `Nuvarande kostnad: ${amountText}\n` +
        `Fakturanummer: ${invoiceNumber}\n\n` +
        `Kan ni matcha ett mer konkurrenskraftigt erbjudande och återkomma skriftligt?\n\n` +
        `Med vänlig hälsning`,
    },
    {
      type: "cancel_email",
      templateId: "specification-request",
      templateLabel: "Specifikationsmall",
      subject: `Begäran om fakturaspecifikation ${invoiceNumber}`,
      body:
        `Hej,\n\n` +
        `Jag behöver hjälp att förtydliga min senaste faktura från ${vendor}.\n` +
        `Belopp: ${amountText}\n` +
        `Förfallodatum: ${dueDateText}\n` +
        `Betalsätt: ${paymentMethod}\n` +
        `Kundnummer: ${customer}\n\n` +
        `Kan ni förklara kostnadsposterna och bekräfta att allt är korrekt debiterat?\n\n` +
        `Tack!\n` +
        `Med vänlig hälsning`,
    },
    {
      type: "cancel_email",
      templateId: "specification-dispute",
      templateLabel: "Specifikation: invändning",
      subject: `Invändning och begäran om underlag för faktura ${invoiceNumber}`,
      body:
        `Hej,\n\n` +
        `Jag vill bestrida delar av fakturan från ${vendor} tills fullständig specifikation finns.\n` +
        `Fakturanummer: ${invoiceNumber}\n` +
        `Belopp: ${amountText}\n\n` +
        `Skicka tydligt underlag per kostnadspost inklusive datum, omfattning och pris.\n\n` +
        `Med vänlig hälsning`,
    },
  ];
}

function buildCategoryTemplates(category, context) {
  const { vendor, customer, invoiceNumber, amountText, dueDateText } = context;

  if (category === "Mobil" || category === "Internet") {
    return [
      {
        type: "cancel_email",
        templateId: "connectivity-loyalty",
        templateLabel: "Lojalitetsrabatt",
        subject: `Lojalitetsförslag för befintlig kund ${customer}`,
        body:
          `Hej,\n\n` +
          `Jag har varit kund hos ${vendor} en längre tid och vill se om ni kan erbjuda en lojalitetsrabatt.\n` +
          `Nuvarande kostnad: ${amountText}\n` +
          `Fakturanummer: ${invoiceNumber}\n\n` +
          `Om ni kan matcha marknadsnivå fortsätter jag gärna som kund.\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "connectivity-binding-check",
        templateLabel: "Bindningstid och villkor",
        subject: `Begäran om bindningstid och uppsägningsvillkor`,
        body:
          `Hej,\n\n` +
          `Jag vill få en tydlig sammanställning av mitt avtal hos ${vendor}.\n` +
          `Kundnummer: ${customer}\n` +
          `Fakturanummer: ${invoiceNumber}\n` +
          `Förfallodatum: ${dueDateText}\n\n` +
          `Vänligen återkom med aktuell bindningstid, uppsägningstid och eventuell slutfaktura.\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "connectivity-downgrade",
        templateLabel: "Nedgradera abonnemang",
        subject: `Förfrågan om billigare paket`,
        body:
          `Hej,\n\n` +
          `Jag vill nedgradera mitt abonnemang hos ${vendor} till en lägre prisnivå.\n` +
          `Nuvarande kostnad: ${amountText}\n` +
          `Kundnummer: ${customer}\n\n` +
          `Skicka gärna alternativ med lägre månadspris och vad som ingår i varje nivå.\n\n` +
          `Med vänlig hälsning`,
      },
    ];
  }

  if (category === "El") {
    return [
      {
        type: "cancel_email",
        templateId: "electricity-price-review",
        templateLabel: "Elprisförhandling",
        subject: `Översyn av elpris och avtalsnivå`,
        body:
          `Hej,\n\n` +
          `Jag vill omförhandla mitt nuvarande elavtal hos ${vendor}.\n` +
          `Nuvarande debitering: ${amountText}\n` +
          `Fakturanummer: ${invoiceNumber}\n\n` +
          `Kan ni erbjuda ett lägre pris eller ett alternativt avtal som bättre motsvarar min förbrukning?\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "electricity-grid-breakdown",
        templateLabel: "Nät- och avgiftsspec",
        subject: `Begäran om tydlig uppdelning av elavgifter`,
        body:
          `Hej,\n\n` +
          `Jag vill få en specificerad förklaring av min elfaktura från ${vendor}.\n` +
          `Belopp: ${amountText}\n` +
          `Fakturanummer: ${invoiceNumber}\n\n` +
          `Vänligen dela upp kostnaden per elhandel, nätavgift, skatter och övriga avgifter.\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "electricity-switch-intent",
        templateLabel: "Byte av elleverantör",
        subject: `Sista offert innan leverantörsbyte`,
        body:
          `Hej,\n\n` +
          `Jag utvärderar att byta från ${vendor} och vill ge er möjlighet att lämna ett förbättrat erbjudande.\n` +
          `Fakturanummer: ${invoiceNumber}\n` +
          `Nuvarande kostnad: ${amountText}\n\n` +
          `Om ni kan erbjuda bättre villkor återkommer jag gärna med fortsatt avtal.\n\n` +
          `Med vänlig hälsning`,
      },
    ];
  }

  if (category === "Försäkring") {
    return [
      {
        type: "cancel_email",
        templateId: "insurance-premium-review",
        templateLabel: "Premieöversyn",
        subject: `Begäran om premieöversyn`,
        body:
          `Hej,\n\n` +
          `Jag vill se över premien för min försäkring hos ${vendor}.\n` +
          `Nuvarande kostnad: ${amountText}\n` +
          `Kundnummer: ${customer}\n\n` +
          `Kan ni erbjuda en lägre premie eller ett upplägg med samma skydd men bättre pris?\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "insurance-terms-check",
        templateLabel: "Villkor och självrisk",
        subject: `Förtydligande av villkor och självrisk`,
        body:
          `Hej,\n\n` +
          `Jag vill få ett skriftligt förtydligande av villkor för min försäkring hos ${vendor}.\n` +
          `Fakturanummer: ${invoiceNumber}\n` +
          `Belopp: ${amountText}\n\n` +
          `Vänligen specificera självrisknivåer, undantag och omfattning för mitt nuvarande avtal.\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "insurance-bundle-discount",
        templateLabel: "Samlingsrabatt",
        subject: `Förfrågan om samlingsrabatt`,
        body:
          `Hej,\n\n` +
          `Jag vill undersöka samlingsrabatt hos ${vendor} för att sänka min försäkringskostnad.\n` +
          `Nuvarande kostnad: ${amountText}\n` +
          `Kundnummer: ${customer}\n\n` +
          `Skicka gärna förslag på paket och hur mycket jag kan spara per månad.\n\n` +
          `Med vänlig hälsning`,
      },
    ];
  }

  if (category === "Streaming") {
    return [
      {
        type: "cancel_email",
        templateId: "streaming-plan-review",
        templateLabel: "Paketöversyn",
        subject: `Fråga om billigare abonnemang`,
        body:
          `Hej,\n\n` +
          `Jag vill se om det finns ett billigare abonnemang hos ${vendor}.\n` +
          `Nuvarande månadskostnad: ${amountText}\n` +
          `Kundnummer: ${customer}\n\n` +
          `Har ni något alternativ med lägre pris som passar samma användning?\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "streaming-pause-or-cancel",
        templateLabel: "Pausa eller avsluta",
        subject: `Paus eller uppsägning av abonnemang`,
        body:
          `Hej,\n\n` +
          `Jag vill pausa eller avsluta mitt abonnemang hos ${vendor}.\n` +
          `Kundnummer: ${customer}\n` +
          `Förfallodatum: ${dueDateText}\n\n` +
          `Vänligen återkom med vilka alternativ som finns och hur uppsägningen påverkar debiteringen.\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "streaming-annual-discount",
        templateLabel: "Årsplan/rabatt",
        subject: `Förfrågan om årsplan eller lojalitetsrabatt`,
        body:
          `Hej,\n\n` +
          `Jag vill behålla tjänsten hos ${vendor}, men till lägre kostnad.\n` +
          `Nuvarande kostnad: ${amountText}\n` +
          `Kundnummer: ${customer}\n\n` +
          `Erbjuder ni årsbetalning, familjeplan eller annan rabatt som sänker månadskostnaden?\n\n` +
          `Med vänlig hälsning`,
      },
    ];
  }

  if (category === "Bank") {
    return [
      {
        type: "cancel_email",
        templateId: "bank-fee-review",
        templateLabel: "Avgiftsöversyn",
        subject: `Begäran om översyn av bankavgifter`,
        body:
          `Hej,\n\n` +
          `Jag vill se över avgifterna kopplade till mitt konto hos ${vendor}.\n` +
          `Debiterat belopp: ${amountText}\n` +
          `Kundnummer: ${customer}\n\n` +
          `Vänligen föreslå alternativ med lägre kostnad och beskriv vad som kan justeras.\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "bank-rate-negotiation",
        templateLabel: "Ränteförhandling",
        subject: `Förfrågan om bättre ränta eller villkor`,
        body:
          `Hej,\n\n` +
          `Jag vill diskutera bättre villkor för mina banktjänster hos ${vendor}.\n` +
          `Fakturanummer: ${invoiceNumber}\n` +
          `Belopp: ${amountText}\n\n` +
          `Kan ni erbjuda en förbättrad räntenivå eller ett mer förmånligt upplägg?\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "bank-package-downgrade",
        templateLabel: "Byt till baspaket",
        subject: `Begäran om enklare bankpaket`,
        body:
          `Hej,\n\n` +
          `Jag vill byta till ett enklare och billigare kontopaket hos ${vendor}.\n` +
          `Kundnummer: ${customer}\n` +
          `Nuvarande kostnad: ${amountText}\n\n` +
          `Skicka gärna förslag på baspaket och vilka avgifter som försvinner.\n\n` +
          `Med vänlig hälsning`,
      },
    ];
  }

  if (category === "Tjänst") {
    return [
      {
        type: "cancel_email",
        templateId: "service-cost-clarification",
        templateLabel: "Tjänst: Kostnadsförklaring",
        subject: `Begäran om kostnadsförklaring för faktura ${invoiceNumber}`,
        body:
          `Hej,\n\n` +
          `Jag vill få en tydlig genomgång av fakturan för utfört arbete hos ${vendor}.\n` +
          `Fakturanummer: ${invoiceNumber}\n` +
          `Belopp: ${amountText}\n` +
          `Kundnummer: ${customer}\n\n` +
          `Vänligen specificera materialkostnad, timpris, antal timmar och eventuella övriga avgifter.\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "service-price-check",
        templateLabel: "Tjänst: Prisjämförelse",
        subject: `Fråga om prisnivå för utförd tjänst`,
        body:
          `Hej,\n\n` +
          `Jag vill kontrollera prisnivån på arbetet som fakturerats av ${vendor}.\n` +
          `Fakturanummer: ${invoiceNumber}\n` +
          `Belopp: ${amountText}\n\n` +
          `Kan ni bekräfta att priset följer överenskommen offert samt redovisa hur totalen beräknats?\n\n` +
          `Med vänlig hälsning`,
      },
      {
        type: "cancel_email",
        templateId: "service-material-hours-proof",
        templateLabel: "Tjänst: Material/timmar",
        subject: `Begäran om underlag för material och arbetstid`,
        body:
          `Hej,\n\n` +
          `Jag önskar komplett underlag för den utförda tjänsten från ${vendor}.\n` +
          `Fakturanummer: ${invoiceNumber}\n` +
          `Belopp: ${amountText}\n\n` +
          `Vänligen redovisa antal timmar, timpris, materiallista, á-priser och eventuella påslag.\n\n` +
          `Med vänlig hälsning`,
      },
    ];
  }

  return [
    {
      type: "cancel_email",
      templateId: "generic-price-review",
      templateLabel: "Allmän prisöversyn",
      subject: `Begäran om prisöversyn`,
      body:
        `Hej,\n\n` +
        `Jag vill se över kostnaden för min tjänst hos ${vendor}.\n` +
        `Nuvarande belopp: ${amountText}\n` +
        `Kundnummer: ${customer}\n\n` +
        `Kan ni erbjuda ett bättre pris eller en mer passande nivå?\n\n` +
        `Med vänlig hälsning`,
    },
    {
      type: "cancel_email",
      templateId: "generic-termination-followup",
      templateLabel: "Uppsägning med uppföljning",
      subject: `Begäran om uppsägning och bekräftelse`,
      body:
        `Hej,\n\n` +
        `Jag önskar säga upp avtalet hos ${vendor}.\n` +
        `Kundnummer: ${customer}\n` +
        `Fakturanummer: ${invoiceNumber}\n\n` +
        `Vänligen bekräfta slutdatum, uppsägningstid och om någon ytterligare debitering tillkommer.\n\n` +
        `Med vänlig hälsning`,
    },
    {
      type: "cancel_email",
      templateId: "generic-charge-question",
      templateLabel: "Fråga om debitering",
      subject: `Begäran om förklaring av debitering`,
      body:
        `Hej,\n\n` +
        `Jag behöver ett tydligt underlag för debiteringen från ${vendor}.\n` +
        `Fakturanummer: ${invoiceNumber}\n` +
        `Belopp: ${amountText}\n` +
        `Förfallodatum: ${dueDateText}\n\n` +
        `Vänligen återkom med specifikation och hur kostnaden har beräknats.\n\n` +
        `Med vänlig hälsning`,
    },
  ];
}

function normalizeCategory(value) {
  const text = String(value || "").trim().toLowerCase();
  const categoryMap = {
    mobil: "Mobil",
    internet: "Internet",
    el: "El",
    försäkring: "Försäkring",
    forsakring: "Försäkring",
    streaming: "Streaming",
    bank: "Bank",
    tjänst: "Tjänst",
    tjanst: "Tjänst",
    service: "Tjänst",
    hantverk: "Tjänst",
    installation: "Tjänst",
    renovering: "Tjänst",
    övrigt: "Övrigt",
    ovrigt: "Övrigt",
  };

  return categoryMap[text] || "Övrigt";
}
